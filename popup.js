const $ = (selector) => document.querySelector(selector);

const STORAGE_KEY = "appProgressItems";
const BACKUP_META_KEY = "appProgressBackupMeta";
const APP_VERSION = chrome.runtime.getManifest().version;

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function buildNewUrl(tab, pageData = {}) {
  const pageAppName = pageData.offerTitle || "";
  const pagePlatform = pageData.platform || "";
  const title = pageAppName || tab.title || "";

  const params = new URLSearchParams({
    title,
    url: tab.url || ""
  });

  if (pageAppName) params.set("pageAppName", pageAppName);
  if (pagePlatform) params.set("pagePlatform", pagePlatform);
  if (pageData.documentTitle) params.set("pageTitle", pageData.documentTitle);
  if (pageData.source) params.set("pageSource", pageData.source);

  return chrome.runtime.getURL(`edit.html?${params.toString()}`);
}

function isInjectablePage(url) {
  return /^https?:\/\//i.test(url || "");
}

async function extractCurrentPageOfferData(tab) {
  if (!tab?.id || !isInjectablePage(tab.url) || !chrome.scripting?.executeScript) return null;

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const normalize = (value) => String(value || "")
          .replace(/[\u3000\t\r\n]+/g, " ")
          .replace(/\s{2,}/g, " ")
          .trim();

        const unique = (values) => {
          const seen = new Set();
          return values
            .map(normalize)
            .filter(Boolean)
            .filter((value) => {
              const key = value.toLowerCase();
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
        };

        const getMetaContent = (selector) => normalize(document.querySelector(selector)?.getAttribute("content") || "");

        const metaTexts = unique([
          getMetaContent('meta[property="og:title"]'),
          getMetaContent('meta[name="twitter:title"]'),
          getMetaContent('meta[name="application-name"]'),
          getMetaContent('meta[name="apple-mobile-web-app-title"]'),
          getMetaContent('meta[name="title"]')
        ]);

        function collectJsonLdNames() {
          const names = [];
          document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
            try {
              const parsed = JSON.parse(script.textContent || "null");
              const nodes = Array.isArray(parsed) ? parsed : [parsed];
              nodes.forEach((node) => {
                if (!node || typeof node !== "object") return;
                if (typeof node.name === "string") names.push(node.name);
                if (Array.isArray(node["@graph"])) {
                  node["@graph"].forEach((graphNode) => {
                    if (graphNode && typeof graphNode.name === "string") names.push(graphNode.name);
                  });
                }
              });
            } catch {
              // JSON-LDはページによって壊れていることがあるため無視する。
            }
          });
          return unique(names);
        }

        const selectorTexts = [];
        const selectors = [
          "h1",
          "h2",
          "[data-testid*='title' i]",
          "[data-testid*='name' i]",
          "[class*='title' i]",
          "[class*='name' i]",
          "[class*='campaign' i]",
          "[class*='offer' i]",
          "[aria-label*='title' i]",
          "[aria-label*='name' i]"
        ];

        document.querySelectorAll(selectors.join(",")).forEach((element) => {
          const text = normalize(element.innerText || element.textContent || element.getAttribute("aria-label") || "");
          if (text) selectorTexts.push(text);
        });

        const bodyText = document.body?.innerText || "";
        const bodyLines = unique(bodyText.split("\n").slice(0, 160));
        const documentTitle = normalize(document.title || "");
        const url = location.href;

        function splitCandidateText(value) {
          return normalize(value)
            .split(/\s*[|｜]\s*|\s+[-–—]\s+|\s*[：:]\s*|\s*[／/]\s*/)
            .map(normalize)
            .filter(Boolean);
        }

        function looksLikeTitle(value) {
          const text = normalize(value);
          if (!text || text.length < 2 || text.length > 80) return false;
          if (/^https?:\/\//i.test(text)) return false;
          if (/^[\d,\.]+\s*(円|pt|pts|p|ポイント)?$/i.test(text)) return false;
          if (/^[\d\-–—_:：/／.\s]+$/.test(text)) return false;
          if (/mychips|offerwall|オファーウォール/i.test(text)) return false;
          if (/^(back|戻る|詳細|ミッション|条件|報酬|獲得|ポイント|インストール|プレイ|開始|達成|承認|問い合わせ|サポート)$/i.test(text)) return false;
          if (/利用規約|プライバシー|disclaimer|support|contact|help/i.test(text)) return false;
          return /[A-Za-z\u3040-\u30ff\u3400-\u9fff]/.test(text);
        }

        function scoreTitle(value, source, index) {
          const text = normalize(value);
          if (!looksLikeTitle(text)) return -1000;

          let score = 0;
          if (source === "jsonld") score += 95;
          if (source === "selector") score += 86;
          if (source === "meta") score += 78;
          if (source === "document-title") score += 54;
          if (source === "body-line") score += Math.max(20, 62 - index);

          if (text.length >= 3 && text.length <= 42) score += 16;
          if (text.length > 58) score -= 18;
          if (/\b(iOS|iPhone|iPad|Android)\b/i.test(text)) score += 6;
          if (/\d[\d,\.]*\s*(円|pt|pts|p|ポイント)/i.test(text)) score -= 28;
          if (/\d+\s*(日|days?)\s*(以内|within)/i.test(text)) score -= 18;
          if (/条件|報酬|成果|達成|到達|クリア|インストール|step|mission|reward|reach|level/i.test(text)) score -= 20;
          if (/^[A-Za-z0-9]{10,}$/.test(text) && /\d/.test(text)) score -= 30;

          return score;
        }

        const rawCandidates = [];
        collectJsonLdNames().forEach((value, index) => rawCandidates.push({ value, source: "jsonld", index }));
        metaTexts.forEach((value, index) => {
          splitCandidateText(value).forEach((part) => rawCandidates.push({ value: part, source: "meta", index }));
        });
        selectorTexts.forEach((value, index) => {
          splitCandidateText(value).forEach((part) => rawCandidates.push({ value: part, source: "selector", index }));
        });
        splitCandidateText(documentTitle).forEach((part, index) => rawCandidates.push({ value: part, source: "document-title", index }));
        bodyLines.forEach((value, index) => {
          splitCandidateText(value).forEach((part) => rawCandidates.push({ value: part, source: "body-line", index }));
        });

        const bestTitle = unique(rawCandidates.map((candidate) => candidate.value))
          .map((value) => {
            const matched = rawCandidates.find((candidate) => normalize(candidate.value).toLowerCase() === value.toLowerCase()) || { source: "body-line", index: 99 };
            return {
              value,
              score: scoreTitle(value, matched.source, matched.index),
              source: matched.source
            };
          })
          .sort((a, b) => b.score - a.score)[0];

        const firstTextBlock = bodyLines.slice(0, 80).join("\n");
        const allText = `${firstTextBlock}\n${metaTexts.join("\n")}\n${selectorTexts.join("\n")}`;

        function detectPlatform() {
          let iosScore = 0;
          let androidScore = 0;

          const iosPatterns = [/\biOS\b/i, /\biPhone\b/i, /\biPad\b/i, /App\s*Store/i, /Apple\s*Store/i];
          const androidPatterns = [/\bAndroid\b/i, /Google\s*Play/i, /Play\s*Store/i];

          bodyLines.slice(0, 120).forEach((line, index) => {
            const weight = index < 50 ? 5 : 2;
            if (iosPatterns.some((pattern) => pattern.test(line))) iosScore += weight;
            if (androidPatterns.some((pattern) => pattern.test(line))) androidScore += weight;
          });

          if (iosPatterns.some((pattern) => pattern.test(allText))) iosScore += 4;
          if (androidPatterns.some((pattern) => pattern.test(allText))) androidScore += 4;

          try {
            const parsed = new URL(location.href);
            if (parsed.searchParams.get("idfa")) iosScore += 12;
            if (parsed.searchParams.get("gaid")) androidScore += 12;
            const osParam = normalize(parsed.searchParams.get("os") || parsed.searchParams.get("platform") || parsed.searchParams.get("device") || "");
            if (/ios|iphone|ipad/i.test(osParam)) iosScore += 12;
            if (/android/i.test(osParam)) androidScore += 12;
          } catch {
            // URL解析に失敗した場合は無視する。
          }

          if (iosScore > 0 && androidScore === 0) return "ios";
          if (androidScore > 0 && iosScore === 0) return "android";
          if (iosScore >= androidScore + 6) return "ios";
          if (androidScore >= iosScore + 6) return "android";
          if (iosScore > 0 && androidScore > 0) return "both";
          return "";
        }

        return {
          offerTitle: bestTitle && bestTitle.score > 0 ? bestTitle.value : "",
          platform: detectPlatform(),
          documentTitle,
          source: bestTitle?.source || "",
          url
        };
      }
    });

    return result?.result || null;
  } catch (error) {
    console.info("ページ内容の取得をスキップしました:", error.message);
    return null;
  }
}

function getLocal(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

async function showBackupReminderIfNeeded() {
  const result = await getLocal([STORAGE_KEY, BACKUP_META_KEY]);
  const items = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  const meta = result[BACKUP_META_KEY] && typeof result[BACKUP_META_KEY] === "object"
    ? result[BACKUP_META_KEY]
    : {};

  const hasItems = items.length > 0;
  const alreadyBackedUpThisVersion = meta.lastBackupVersion === APP_VERSION;
  const dismissed = meta.backupNoticeDismissedForVersion === APP_VERSION;
  $("#popupBackupReminder").hidden = !hasItems || alreadyBackedUpThisVersion || dismissed;
}

$("#recordCurrent").addEventListener("click", async () => {
  const message = $("#message");
  try {
    const tab = await getCurrentTab();
    if (!tab || !tab.url) {
      message.textContent = "現在のページ情報を取得できませんでした。";
      return;
    }

    message.textContent = "ページ情報を確認しています…";
    const pageData = await extractCurrentPageOfferData(tab);
    await chrome.tabs.create({ url: buildNewUrl(tab, pageData || {}) });
    window.close();
  } catch (error) {
    message.textContent = `エラー: ${error.message}`;
  }
});

$("#openList").addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("list.html") });
  window.close();
});

$("#openPrivacy").addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("privacy.html") });
  window.close();
});

showBackupReminderIfNeeded();

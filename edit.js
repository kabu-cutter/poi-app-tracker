const fields = [
  "id",
  "appName",
  "title",
  "siteName",
  "reward",
  "url",
  "installDate",
  "startDate",
  "deadline",
  "status",
  "progress",
  "inquiryNo",
  "condition",
  "memo"
];

const $ = (selector) => document.querySelector(selector);

let logs = [];
let allItems = [];
let currentEditId = "";
let lastSuggestedAppName = "";
let lastSuggestedSiteName = "";
let dismissedRegistrationHintKeys = new Set();

function getParams() {
  return new URLSearchParams(location.search);
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function createLogId() {
  return `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function setValue(id, value) {
  const element = $(`#${id}`);
  if (element) element.value = value || "";
}

function getValue(id) {
  const element = $(`#${id}`);
  return element ? element.value.trim() : "";
}

function normalizeSpaces(value) {
  return String(value || "")
    .replace(/[\u3000\t\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function stripKnownSiteWords(value) {
  return String(value || "")
    .replace(/モッピー|Moppy/gi, "")
    .replace(/ワラウ|Warau/gi, "")
    .replace(/アメフリ|Amefri/gi, "")
    .replace(/ハピタス|Hapitas/gi, "")
    .replace(/ちょびリッチ|Chobirich/gi, "")
    .replace(/ポイントインカム|PointIncome|Pointi/gi, "")
    .replace(/colleee/gi, "")
    .replace(/げん玉|Gendama/gi, "")
    .replace(/Freecash/gi, "")
    .replace(/トリマ|Torima/gi, "");
}

function cleanAppNameCandidate(value) {
  let text = normalizeSpaces(value);

  text = stripKnownSiteWords(text);
  text = text
    .replace(/[【】\[\]「」『』]/g, " ")
    .replace(/案件詳細|案件ページ|案件名|ゲーム案件|アプリ案件/g, " ")
    .replace(/ポイ活|ポイントサイト|ポイント|攻略|無料|スマホゲーム/g, " ")
    .replace(/報酬[：: ]?.*$/g, "")
    .replace(/獲得[：: ]?.*$/g, "")
    .replace(/\d[\d,\.]*\s*(円|pt|pts|p|ポイント).*$/gi, "")
    .replace(/\d+\s*(日|days?)\s*(以内|within).*$/gi, "")
    .replace(/\s*(インストール|達成|到達|クリア|承認|成果|条件|参加|プレイ|reach).*$/g, "")
    .replace(/^[\s\-–—_＿:：|｜/／]+|[\s\-–—_＿:：|｜/／]+$/g, "");

  return normalizeSpaces(text);
}

function normalizeCandidateKey(value) {
  return cleanAppNameCandidate(value)
    .toLowerCase()
    .replace(/ios/g, "ios")
    .replace(/android/g, "android")
    .replace(/[\s\u3000・･\-–—_＿:：|｜/／【】\[\]「」『』()（）.,]/g, "");
}

function getCandidateTokens(value) {
  return cleanAppNameCandidate(value)
    .toLowerCase()
    .split(/[\s\u3000・･\-–—_＿:：|｜/／()（）.,]+/)
    .filter((token) => token && token.length >= 2);
}

function candidateSimilarity(a, b) {
  const aKey = normalizeCandidateKey(a);
  const bKey = normalizeCandidateKey(b);
  if (!aKey || !bKey) return 0;
  if (aKey === bKey) return 1;
  if (aKey.includes(bKey) || bKey.includes(aKey)) return 0.85;

  const aTokens = new Set(getCandidateTokens(a));
  const bTokens = new Set(getCandidateTokens(b));
  if (!aTokens.size || !bTokens.size) return 0;

  let overlap = 0;
  aTokens.forEach((token) => {
    if (bTokens.has(token)) overlap += 1;
  });

  return overlap / Math.max(aTokens.size, bTokens.size);
}

function scoreAppNameCandidate(value) {
  const text = cleanAppNameCandidate(value);
  if (!text) return -100;

  let score = 30;
  const length = text.length;
  const tokens = getCandidateTokens(text);

  if (length >= 3 && length <= 36) score += 18;
  if (length > 48) score -= 18;
  if (tokens.length >= 1 && tokens.length <= 5) score += 10;
  if (/案件|詳細|ポイ活|ポイント|報酬|条件|キャンペーン/.test(text)) score -= 25;
  if (/^https?:\/\//i.test(text)) score -= 40;
  if (/^[0-9,\.]+\s*(円|pt|pts|p)$/i.test(text)) score -= 30;
  if (/^[a-z0-9]{10,}$/i.test(text) && /\d/.test(text)) score -= 25;
  if (text.length <= 1) score -= 30;

  return score;
}

function decodeUrlText(value) {
  try {
    return decodeURIComponent(String(value || "").replace(/\+/g, " "));
  } catch {
    return String(value || "").replace(/\+/g, " ");
  }
}

const URL_STOP_WORDS = new Set([
  "ja", "jp", "en", "us", "pc", "sp", "www", "m", "mobile",
  "offer", "offers", "detail", "details", "campaign", "campaigns", "cp",
  "point", "points", "poikatsu", "reward", "rewards", "ad", "ads", "pr",
  "app", "apps", "game", "games", "lp", "item", "items", "entry", "entries",
  "show", "view", "open", "click", "redirect", "link", "tracking", "track"
]);

function isLikelyUrlIdToken(token) {
  const text = String(token || "").toLowerCase();
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  if (/^[0-9a-f]{8,}$/.test(text)) return true;
  if (/^[a-z0-9]{5,}$/.test(text) && /\d/.test(text) && /[a-z]/.test(text)) return true;
  if (text.length >= 16 && /^[a-z0-9]+$/.test(text)) return true;
  return false;
}

function normalizeUrlCandidateToken(token) {
  const raw = String(token || "").trim();
  const lower = raw.toLowerCase();
  if (!raw || URL_STOP_WORDS.has(lower) || isLikelyUrlIdToken(lower)) return "";
  if (lower === "ios") return "iOS";
  if (lower === "iphone") return "iPhone";
  if (lower === "ipad") return "iPad";
  if (lower === "android") return "Android";
  if (lower === "rpg") return "RPG";
  return raw;
}

function titleCaseUrlText(value) {
  return normalizeSpaces(value)
    .split(" ")
    .map((word) => {
      const lower = word.toLowerCase();
      if (["ios", "iphone", "ipad", "android", "rpg"].includes(lower)) {
        return normalizeUrlCandidateToken(lower);
      }
      if (/^[a-z][a-z0-9']*$/i.test(word)) {
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }
      return word;
    })
    .join(" ");
}

function cleanUrlAppNameCandidate(value) {
  const decoded = decodeUrlText(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[\-_+.]+/g, " ");

  const tokens = decoded
    .split(/\s+/)
    .map(normalizeUrlCandidateToken)
    .filter(Boolean);

  const text = titleCaseUrlText(tokens.join(" "));
  return cleanAppNameCandidate(text);
}

function makeAppNameCandidate(value, source, score, reason) {
  const cleaned = source.startsWith("url") ? cleanUrlAppNameCandidate(value) : cleanAppNameCandidate(value);
  if (!cleaned) return null;
  if (/^(iOS|iPhone|iPad|Android)$/i.test(cleaned)) return null;

  const qualityScore = scoreAppNameCandidate(cleaned);
  if (qualityScore <= 0) return null;

  return {
    value: cleaned,
    source,
    score: score + qualityScore,
    reason
  };
}

function getTitleAppNameCandidates(title) {
  const candidates = [];
  const original = normalizeSpaces(title);
  if (!original) return candidates;

  const whole = makeAppNameCandidate(original, "title", 70, "ページタイトル全体から候補にしました。");
  if (whole) candidates.push(whole);

  original
    .split(/\s*[|｜]\s*|\s+[-–—]\s+|\s*[：:]\s*|\s*[／/]\s*/)
    .map((part) => makeAppNameCandidate(part, "title-segment", 88, "ページタイトルの一部から候補にしました。"))
    .filter(Boolean)
    .forEach((candidate) => candidates.push(candidate));

  return candidates;
}

function getUrlAppNameCandidates(url) {
  const candidates = [];
  if (!url) return candidates;

  try {
    const parsed = new URL(url);
    const usefulParamKeys = [
      "app",
      "app_name",
      "appName",
      "game",
      "game_name",
      "gameName",
      "title",
      "name",
      "product",
      "product_name",
      "offer_name",
      "campaign_name"
    ];

    usefulParamKeys.forEach((key) => {
      const value = parsed.searchParams.get(key);
      const candidate = makeAppNameCandidate(value, "url-param", 82, "元ページURLのパラメータから候補にしました。");
      if (candidate) candidates.push(candidate);
    });

    const pathParts = parsed.pathname.split("/").filter(Boolean);
    pathParts.forEach((part, index) => {
      const candidate = makeAppNameCandidate(part, "url-path", 58 + index, "元ページURLのパスから候補にしました。");
      if (candidate) candidates.push(candidate);
    });
  } catch {
    normalizeSpaces(url)
      .split(/[/?#&=]+/)
      .map((part) => makeAppNameCandidate(part, "url-text", 48, "元ページURLの文字列から候補にしました。"))
      .filter(Boolean)
      .forEach((candidate) => candidates.push(candidate));
  }

  return candidates;
}

function buildAppNameSuggestions(title, url = "") {
  const titleCandidates = getTitleAppNameCandidates(title);
  const urlCandidates = getUrlAppNameCandidates(url);
  const allCandidates = [...titleCandidates, ...urlCandidates];

  allCandidates.forEach((candidate) => {
    const oppositeCandidates = candidate.source.startsWith("url") ? titleCandidates : urlCandidates;
    const hasCloseMatch = oppositeCandidates.some((other) => candidateSimilarity(candidate.value, other.value) >= 0.85);
    if (hasCloseMatch) {
      candidate.score += 30;
      candidate.reason = `${candidate.reason} ページタイトルとURLの両方に近い名前があるため、候補として強めに扱います。`;
    }
  });

  const bestByKey = new Map();
  allCandidates.forEach((candidate) => {
    const key = normalizeCandidateKey(candidate.value);
    if (!key) return;
    const current = bestByKey.get(key);
    if (!current || candidate.score > current.score) bestByKey.set(key, candidate);
  });

  return [...bestByKey.values()].sort((a, b) => b.score - a.score);
}

function guessAppName(title, url = "") {
  const suggestions = buildAppNameSuggestions(title, url);
  return suggestions[0]?.value || "";
}

function guessSiteName(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const rules = [
      ["moppy", "モッピー"],
      ["pc.moppy", "モッピー"],
      ["sp.moppy", "モッピー"],
      ["warau", "ワラウ"],
      ["amefri", "アメフリ"],
      ["hapitas", "ハピタス"],
      ["chobirich", "ちょびリッチ"],
      ["pointi", "ポイントインカム"],
      ["point-income", "ポイントインカム"],
      ["colleee", "colleee"],
      ["gendama", "げん玉"],
      ["freecash", "Freecash"],
      ["torima", "トリマ"],
      ["poikatsu", "ポイ活サイト"],
      ["point", "ポイントサイト"]
    ];
    const found = rules.find(([keyword]) => host.includes(keyword));
    return found ? found[1] : "";
  } catch {
    return "";
  }
}

function normalizeUrlForCompare(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin.toLowerCase()}${pathname}${parsed.search}`;
  } catch {
    return normalizeSpaces(url).replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

function normalizeAppNameForCompare(value) {
  return cleanAppNameCandidate(value)
    .toLowerCase()
    .replace(/[\s\u3000・･\-–—_＿:：|｜/／【】\[\]「」『』()（）]/g, "");
}

function itemLabel(item) {
  return item.appName || item.title || "名称未設定";
}

function findDuplicateUrlItems(url) {
  const normalizedUrl = normalizeUrlForCompare(url);
  if (!normalizedUrl) return [];

  return allItems.filter((item) => {
    if (item.id === currentEditId) return false;
    return normalizeUrlForCompare(item.url || "") === normalizedUrl;
  });
}

function findSameAppItems(appName) {
  const normalizedAppName = normalizeAppNameForCompare(appName);
  if (!normalizedAppName) return [];

  return allItems.filter((item) => {
    if (item.id === currentEditId) return false;
    const itemName = item.appName || guessAppName(item.title || "", item.url || "");
    return normalizeAppNameForCompare(itemName) === normalizedAppName;
  });
}

function buildExistingItemLinks(items) {
  return items.slice(0, 5).map((item) => {
    const label = escapeHtml(itemLabel(item));
    const site = escapeHtml(item.siteName || "サイト未入力");
    const reward = escapeHtml(item.reward || "報酬未入力");
    const status = escapeHtml(item.status || "状態未入力");
    const href = `edit.html?id=${encodeURIComponent(item.id)}`;
    return `<li><a href="${href}">${label}</a><span>${site} / ${reward} / ${status}</span></li>`;
  }).join("");
}

function hintKey(type, value) {
  return `${type}:${normalizeSpaces(value)}`;
}

function isHintDismissed(type, value) {
  return dismissedRegistrationHintKeys.has(hintKey(type, value));
}

function renderDiscardButton(type, value) {
  return `<button type="button" class="secondary compact suggestion-discard" data-discard-hint="${escapeAttribute(type)}" data-discard-value="${escapeAttribute(value)}">Discard</button>`;
}

function renderAppNameSuggestion(candidate, type) {
  if (!candidate || !candidate.value || isHintDismissed(type, candidate.value)) return "";
  const label = candidate.source.startsWith("url") ? "URLからのアプリ名候補" : "アプリ名候補";
  return `
      <div class="suggestion-item suggestion-info">
        <div>
          <strong>${escapeHtml(label)}</strong>
          <p>${escapeHtml(candidate.reason)} 「${escapeHtml(candidate.value)}」を候補にしました。</p>
        </div>
        <div class="suggestion-actions">
          <button type="button" class="secondary compact" data-apply-app-name="${escapeAttribute(candidate.value)}">候補を使う</button>
          ${renderDiscardButton(type, candidate.value)}
        </div>
      </div>
    `;
}

function renderRegistrationHints() {
  const container = $("#registrationHints");
  const list = $("#registrationHintList");
  if (!container || !list) return;

  const title = getValue("title");
  const appName = getValue("appName");
  const url = getValue("url");
  const siteName = getValue("siteName");
  const appNameSuggestions = buildAppNameSuggestions(title, url);
  const primaryAppNameSuggestion = appNameSuggestions[0] || null;
  const suggestedAppName = primaryAppNameSuggestion?.value || "";
  const urlAppNameSuggestion = appNameSuggestions.find((candidate) => {
    if (!candidate.source.startsWith("url")) return false;
    if (!candidate.value) return false;
    if (candidate.value === appName) return false;
    if (candidate.value === suggestedAppName) return false;
    return candidateSimilarity(candidate.value, appName || suggestedAppName) < 0.85;
  });
  const suggestedSiteName = guessSiteName(url);
  const duplicateUrlItems = findDuplicateUrlItems(url);
  const sameAppItems = findSameAppItems(appName || suggestedAppName);
  const hints = [];

  if (primaryAppNameSuggestion && suggestedAppName !== appName) {
    const hint = renderAppNameSuggestion(primaryAppNameSuggestion, "app-name");
    if (hint) hints.push(hint);
  }

  if (urlAppNameSuggestion) {
    const hint = renderAppNameSuggestion(urlAppNameSuggestion, "url-app-name");
    if (hint) hints.push(hint);
  }

  if (suggestedSiteName && suggestedSiteName !== siteName && !isHintDismissed("site-name", suggestedSiteName)) {
    hints.push(`
      <div class="suggestion-item suggestion-info">
        <div>
          <strong>サイト名候補</strong>
          <p>URLから「${escapeHtml(suggestedSiteName)}」を候補にしました。</p>
        </div>
        <div class="suggestion-actions">
          <button type="button" class="secondary compact" data-apply-site-name="${escapeAttribute(suggestedSiteName)}">候補を使う</button>
          ${renderDiscardButton("site-name", suggestedSiteName)}
        </div>
      </div>
    `);
  }

  if (duplicateUrlItems.length) {
    hints.push(`
      <div class="suggestion-item suggestion-warning">
        <div>
          <strong>同じURLの案件が登録済みです</strong>
          <p>二重登録かもしれません。必要なら既存の案件を確認してください。</p>
          <ul class="suggestion-existing-list">${buildExistingItemLinks(duplicateUrlItems)}</ul>
        </div>
      </div>
    `);
  }

  if (sameAppItems.length) {
    hints.push(`
      <div class="suggestion-item suggestion-soft">
        <div>
          <strong>同じアプリ名の登録があります</strong>
          <p>別サイト案件との比較に使えます。報酬や状態を確認しておくと安心です。</p>
          <ul class="suggestion-existing-list">${buildExistingItemLinks(sameAppItems)}</ul>
        </div>
      </div>
    `);
  }

  container.hidden = hints.length === 0;
  list.innerHTML = hints.join("");

  list.querySelectorAll("[data-apply-app-name]").forEach((button) => {
    button.addEventListener("click", () => {
      setValue("appName", button.dataset.applyAppName || "");
      lastSuggestedAppName = button.dataset.applyAppName || "";
      updatePreview();
    });
  });

  list.querySelectorAll("[data-apply-site-name]").forEach((button) => {
    button.addEventListener("click", () => {
      setValue("siteName", button.dataset.applySiteName || "");
      lastSuggestedSiteName = button.dataset.applySiteName || "";
      updatePreview();
    });
  });

  list.querySelectorAll("[data-discard-hint]").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.discardHint || "";
      const value = button.dataset.discardValue || "";
      if (type && value) dismissedRegistrationHintKeys.add(hintKey(type, value));
      renderRegistrationHints();
    });
  });
}

function maybeUpdateAppNameFromTitle() {
  const title = getValue("title");
  const appName = getValue("appName");
  const url = getValue("url");
  const suggestion = guessAppName(title, url);
  if (!suggestion) return;

  if (!appName || appName === lastSuggestedAppName) {
    setValue("appName", suggestion);
    lastSuggestedAppName = suggestion;
  }
}

function maybeUpdateSiteNameFromUrl() {
  const url = getValue("url");
  const siteName = getValue("siteName");
  const suggestion = guessSiteName(url);
  if (!suggestion) return;

  if (!siteName || siteName === lastSuggestedSiteName) {
    setValue("siteName", suggestion);
    lastSuggestedSiteName = suggestion;
  }
}

function updatePreview() {
  const title = getValue("title") || getValue("appName") || "案件リンク";
  const url = getValue("url");

  $("#previewTitle").textContent = title;
  $("#previewUrl").textContent = url;
  $("#previewOpen").href = url || "#";

  renderRegistrationHints();
}

function renderLogs() {
  const list = $("#logList");

  if (!logs.length) {
    list.innerHTML = '<p class="empty-inline">まだ進行ログはありません。</p>';
    return;
  }

  list.innerHTML = logs.map((log, index) => `
    <div class="log-editor" data-log-index="${index}">
      <input class="log-date" type="date" value="${escapeAttribute(log.date || "")}" aria-label="ログの日付" />
      <textarea class="log-text" rows="3" placeholder="例：Lv.18。広告視聴で少し進めた。">${escapeHtml(log.text || "")}</textarea>
      <button type="button" class="danger compact log-delete">削除</button>
    </div>
  `).join("");

  list.querySelectorAll(".log-editor").forEach((row) => {
    const index = Number(row.dataset.logIndex);

    row.querySelector(".log-date").addEventListener("input", (event) => {
      logs[index].date = event.target.value;
    });

    row.querySelector(".log-text").addEventListener("input", (event) => {
      logs[index].text = event.target.value;
    });

    row.querySelector(".log-delete").addEventListener("click", () => {
      logs.splice(index, 1);
      renderLogs();
    });
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function collectLogs() {
  return logs
    .map((log) => ({
      id: log.id || createLogId(),
      date: log.date || "",
      text: log.text || "",
      createdAt: log.createdAt || new Date().toISOString()
    }))
    .filter((log) => log.date || log.text)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function load() {
  const params = getParams();
  currentEditId = params.get("id") || "";
  allItems = await getItems();

  if (currentEditId) {
    const item = allItems.find((entry) => entry.id === currentEditId) || await findItem(currentEditId);

    if (!item) {
      $("#message").textContent = "案件が見つかりませんでした。";
      return;
    }

    $("#pageTitle").textContent = "案件編集";
    fields.forEach((field) => setValue(field, item[field]));
    logs = Array.isArray(item.logs) ? item.logs.map((log) => ({ ...log })) : [];
    lastSuggestedAppName = getValue("appName");
    lastSuggestedSiteName = getValue("siteName");
  } else {
    const title = params.get("title") || "";
    const url = params.get("url") || "";
    const suggestedAppName = guessAppName(title, url);
    const suggestedSiteName = guessSiteName(url);

    setValue("title", title);
    setValue("appName", suggestedAppName);
    setValue("siteName", suggestedSiteName);
    setValue("url", url);
    lastSuggestedAppName = suggestedAppName;
    lastSuggestedSiteName = suggestedSiteName;

    const today = todayString();
    setValue("installDate", today);
    setValue("startDate", today);
    logs = [];
  }

  updatePreview();
  renderLogs();
}

fields.forEach((field) => {
  const element = $(`#${field}`);
  if (!element) return;

  element.addEventListener("input", () => {
    if (field === "title") maybeUpdateAppNameFromTitle();
    if (field === "url") {
      maybeUpdateSiteNameFromUrl();
      maybeUpdateAppNameFromTitle();
    }
    updatePreview();
  });
});

$("#addLog").addEventListener("click", () => {
  logs.unshift({ id: createLogId(), date: todayString(), text: "", createdAt: new Date().toISOString() });
  renderLogs();
});

$("#itemForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const item = Object.fromEntries(fields.map((field) => [field, getValue(field)]));
  item.logs = collectLogs();

  await saveItem(item);
  $("#message").textContent = "保存しました。";

  setTimeout(() => {
    location.href = "list.html";
  }, 500);
});

load();

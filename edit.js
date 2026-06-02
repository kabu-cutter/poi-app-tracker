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
    .replace(/案件詳細/g, "")
    .replace(/案件ページ/g, "")
    .replace(/ゲーム案件/g, "")
    .replace(/アプリ案件/g, "")
    .replace(/ポイ活/g, "")
    .replace(/攻略/g, "")
    .replace(/報酬[：: ]?.*$/g, "")
    .replace(/ポイント[：: ]?.*$/g, "")
    .replace(/\d+\s*(日|days?)\s*(以内|within).*$/gi, "")
    .replace(/(以内|達成|到達|クリア|承認|インストール).*$/g, "")
    .replace(/^[\s\-–—_＿:：|｜/／]+|[\s\-–—_＿:：|｜/／]+$/g, "");

  return normalizeSpaces(text);
}

function scoreAppNameCandidate(value) {
  const text = cleanAppNameCandidate(value);
  if (!text) return -100;

  let score = Math.min(text.length, 30);
  if (/案件|詳細|ポイ活|ポイント|報酬|条件/.test(text)) score -= 20;
  if (/^https?:\/\//i.test(text)) score -= 30;
  if (/^[0-9,\.]+\s*(円|pt|p)$/i.test(text)) score -= 20;
  if (text.length <= 1) score -= 20;
  return score;
}

function guessAppName(title) {
  const original = normalizeSpaces(title);
  if (!original) return "";

  const splitCandidates = original
    .split(/\s*[|｜]\s*|\s+[-–—]\s+|\s*[：:]\s*/)
    .map(cleanAppNameCandidate)
    .filter(Boolean);

  const candidates = [cleanAppNameCandidate(original), ...splitCandidates]
    .map((candidate) => candidate.replace(/[【】\[\]「」]/g, "").trim())
    .filter(Boolean);

  const uniqueCandidates = [...new Set(candidates)];
  uniqueCandidates.sort((a, b) => scoreAppNameCandidate(b) - scoreAppNameCandidate(a));

  return uniqueCandidates[0] || "";
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
    const itemName = item.appName || guessAppName(item.title || "");
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

function renderRegistrationHints() {
  const container = $("#registrationHints");
  const list = $("#registrationHintList");
  if (!container || !list) return;

  const title = getValue("title");
  const appName = getValue("appName");
  const url = getValue("url");
  const siteName = getValue("siteName");
  const suggestedAppName = guessAppName(title);
  const suggestedSiteName = guessSiteName(url);
  const duplicateUrlItems = findDuplicateUrlItems(url);
  const sameAppItems = findSameAppItems(appName || suggestedAppName);
  const hints = [];

  if (suggestedAppName && suggestedAppName !== appName) {
    hints.push(`
      <div class="suggestion-item suggestion-info">
        <div>
          <strong>アプリ名候補</strong>
          <p>ページタイトルから「${escapeHtml(suggestedAppName)}」を候補にしました。</p>
        </div>
        <button type="button" class="secondary compact" data-apply-app-name="${escapeAttribute(suggestedAppName)}">候補を使う</button>
      </div>
    `);
  }

  if (suggestedSiteName && suggestedSiteName !== siteName) {
    hints.push(`
      <div class="suggestion-item suggestion-info">
        <div>
          <strong>サイト名候補</strong>
          <p>URLから「${escapeHtml(suggestedSiteName)}」を候補にしました。</p>
        </div>
        <button type="button" class="secondary compact" data-apply-site-name="${escapeAttribute(suggestedSiteName)}">候補を使う</button>
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
}

function maybeUpdateAppNameFromTitle() {
  const title = getValue("title");
  const appName = getValue("appName");
  const suggestion = guessAppName(title);
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
    const suggestedAppName = guessAppName(title);
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
    if (field === "url") maybeUpdateSiteNameFromUrl();
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

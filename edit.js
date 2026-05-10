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

function guessAppName(title) {
  return (title || "")
    .replace(/案件詳細/g, "")
    .replace(/ポイント|ポイ活|攻略|報酬/g, "")
    .trim();
}

function guessSiteName(url) {
  try {
    const host = new URL(url).hostname;
    const rules = [
      ["moppy", "モッピー"],
      ["warau", "ワラウ"],
      ["amefri", "アメフリ"],
      ["hapitas", "ハピタス"],
      ["chobirich", "ちょびリッチ"],
      ["pointi", "ポイントインカム"],
      ["colleee", "colleee"],
      ["gendama", "げん玉"]
    ];
    const found = rules.find(([keyword]) => host.includes(keyword));
    return found ? found[1] : "";
  } catch {
    return "";
  }
}

function updatePreview() {
  const title = getValue("title") || getValue("appName") || "案件リンク";
  const url = getValue("url");
  $("#previewTitle").textContent = title;
  $("#previewUrl").textContent = url;
  $("#previewOpen").href = url || "#";
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
  const editId = params.get("id");

  if (editId) {
    const item = await findItem(editId);
    if (!item) {
      $("#message").textContent = "案件が見つかりませんでした。";
      return;
    }
    $("#pageTitle").textContent = "案件編集";
    fields.forEach((field) => setValue(field, item[field]));
    logs = Array.isArray(item.logs) ? item.logs.map((log) => ({ ...log })) : [];
  } else {
    const title = params.get("title") || "";
    const url = params.get("url") || "";
    setValue("title", title);
    setValue("appName", guessAppName(title));
    setValue("siteName", guessSiteName(url));
    setValue("url", url);
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
  if (element) element.addEventListener("input", updatePreview);
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

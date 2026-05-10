const $ = (selector) => document.querySelector(selector);
let allItems = [];

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function deadlineInfo(deadline) {
  if (!deadline) return { label: "", className: "" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(`${deadline}T00:00:00`);
  const diff = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
  if (Number.isNaN(diff)) return { label: "", className: "" };
  if (diff < 0) return { label: `期限切れ ${Math.abs(diff)}日`, className: "expired" };
  if (diff === 0) return { label: "今日まで", className: "today" };
  if (diff === 1) return { label: "明日まで", className: "soon" };
  if (diff <= 3) return { label: `あと${diff}日`, className: "soon" };
  return { label: `あと${diff}日`, className: "normal" };
}

function deadlineSortValue(item) {
  if (!item.deadline) return Number.MAX_SAFE_INTEGER;
  const date = new Date(`${item.deadline}T00:00:00`).getTime();
  return Number.isNaN(date) ? Number.MAX_SAFE_INTEGER : date;
}

function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  return `"${String(value || "").replaceAll('"', '""')}"`;
}

function latestLog(item) {
  const logs = Array.isArray(item.logs) ? item.logs : [];
  return logs
    .filter((log) => log.date || log.text)
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
}

function logsToText(item) {
  const logs = Array.isArray(item.logs) ? item.logs : [];
  return logs
    .filter((log) => log.date || log.text)
    .map((log) => `${log.date || "日付未入力"} ${log.text || ""}`.trim())
    .join("\n");
}

function exportCsv() {
  const headers = [
    "アプリ名", "案件タイトル", "サイト名", "報酬", "元ページURL", "インストール日",
    "開始日", "期限", "状態", "現在の進行度", "問い合わせ番号", "達成条件", "メモ", "最新ログ", "進行ログ", "作成日時", "更新日時"
  ];
  const keys = [
    "appName", "title", "siteName", "reward", "url", "installDate",
    "startDate", "deadline", "status", "progress", "inquiryNo", "condition", "memo"
  ];
  const rows = [headers.map(csvEscape).join(",")];
  allItems.forEach((item) => {
    const log = latestLog(item);
    const values = [
      ...keys.map((key) => item[key]),
      log ? `${log.date || "日付未入力"} ${log.text || ""}`.trim() : "",
      logsToText(item),
      item.createdAt,
      item.updatedAt
    ];
    rows.push(values.map(csvEscape).join(","));
  });
  downloadText(`poi-app-tracker-${new Date().toISOString().slice(0, 10)}.csv`, `\ufeff${rows.join("\n")}`, "text/csv;charset=utf-8");
  $("#backupMessage").textContent = "CSVを出力しました。";
}

function exportJson() {
  const payload = {
    app: "アプリ進行中",
    repository: "poi-app-tracker",
    version: 3,
    exportedAt: new Date().toISOString(),
    storageKey: STORAGE_KEY,
    items: allItems
  };
  downloadText(
    `poi-app-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(payload, null, 2),
    "application/json;charset=utf-8"
  );
  $("#backupMessage").textContent = "バックアップJSONを出力しました。";
}

function parseImportJson(text) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.items)) return parsed.items;
  throw new Error("アプリ進行中のバックアップ形式ではありません。");
}

function renderSummary(items) {
  const activeStatuses = new Set(["未インストール", "進行中", "問い合わせ中", "承認待ち", "保留"]);
  const active = items.filter((item) => activeStatuses.has(item.status || "進行中"));
  const urgent = active.filter((item) => ["expired", "today", "soon"].includes(deadlineInfo(item.deadline).className));
  const waiting = items.filter((item) => item.status === "承認待ち");
  $("#summary").innerHTML = `
    <div class="summary-card"><strong>${items.length}</strong><span>全案件</span></div>
    <div class="summary-card"><strong>${active.length}</strong><span>進行・確認中</span></div>
    <div class="summary-card warning"><strong>${urgent.length}</strong><span>期限注意</span></div>
    <div class="summary-card"><strong>${waiting.length}</strong><span>承認待ち</span></div>
  `;
}

function getFilteredItems() {
  const query = $("#search").value.trim().toLowerCase();
  const status = $("#statusFilter").value;
  const sortMode = $("#sortMode").value;

  const filtered = allItems.filter((item) => {
    const haystack = [item.appName, item.title, item.siteName, item.memo, item.condition, item.progress, item.inquiryNo, logsToText(item)]
      .join(" ")
      .toLowerCase();
    return (!query || haystack.includes(query)) && (!status || item.status === status);
  });

  filtered.sort((a, b) => {
    if (sortMode === "updated") return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    if (sortMode === "created") return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    if (sortMode === "site") return String(a.siteName || "").localeCompare(String(b.siteName || ""), "ja");
    return deadlineSortValue(a) - deadlineSortValue(b) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });

  return filtered;
}

function render() {
  const filtered = getFilteredItems();
  renderSummary(allItems);

  $("#empty").style.display = filtered.length ? "none" : "block";
  $("#items").innerHTML = filtered.map((item) => {
    const title = item.appName || item.title || "名称未設定";
    const info = deadlineInfo(item.deadline);
    const log = latestLog(item);
    return `
      <article class="item-card ${info.className === "expired" ? "is-expired" : ""}">
        <div class="item-main">
          <div class="item-title">${escapeHtml(title)}</div>
          <div class="item-meta">
            <span>サイト：${escapeHtml(item.siteName || "未入力")}</span>
            <span>報酬：${escapeHtml(item.reward || "未入力")}</span>
            <span class="status-pill">${escapeHtml(item.status || "未設定")}</span>
          </div>
          <div class="item-meta">
            <span>インストール日：${escapeHtml(item.installDate || "未入力")}</span>
            <span>期限：${escapeHtml(item.deadline || "未入力")}</span>
            ${info.label ? `<span class="deadline ${info.className}">${escapeHtml(info.label)}</span>` : ""}
          </div>
          ${item.progress ? `<p class="item-note">進行度：${escapeHtml(item.progress)}</p>` : ""}
          ${item.inquiryNo ? `<p class="item-note">問い合わせ番号：${escapeHtml(item.inquiryNo)}</p>` : ""}
          ${log ? `<p class="item-note latest-log">最新ログ：<strong>${escapeHtml(log.date || "日付未入力")}</strong> ${escapeHtml(log.text || "")}</p>` : ""}
          ${item.condition ? `<p class="item-note">条件：${escapeHtml(item.condition)}</p>` : ""}
          ${item.memo ? `<p class="item-note">メモ：${escapeHtml(item.memo)}</p>` : ""}
        </div>
        <div class="item-actions">
          <a class="secondary link-button" href="edit.html?id=${encodeURIComponent(item.id)}">編集</a>
          ${item.url ? `<a class="secondary link-button" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">元ページ</a>` : ""}
          <button class="danger" data-delete="${escapeHtml(item.id)}">削除</button>
        </div>
      </article>
    `;
  }).join("");

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("この案件を削除しますか？")) return;
      await deleteItem(button.dataset.delete);
      allItems = await getItems();
      render();
    });
  });
}

async function load() {
  allItems = await getItems();
  render();
}

$("#search").addEventListener("input", render);
$("#statusFilter").addEventListener("change", render);
$("#sortMode").addEventListener("change", render);
$("#exportCsv").addEventListener("click", exportCsv);
$("#exportJson").addEventListener("click", exportJson);
$("#importJson").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const imported = parseImportJson(text);
    if (!confirm(`現在の案件データを、読み込んだ${imported.length}件のデータで置き換えます。よろしいですか？`)) return;
    const count = await replaceItems(imported);
    allItems = await getItems();
    render();
    $("#backupMessage").textContent = `${count}件のデータを復元しました。`;
  } catch (error) {
    $("#backupMessage").textContent = `復元できませんでした: ${error.message}`;
  } finally {
    event.target.value = "";
  }
});

load();

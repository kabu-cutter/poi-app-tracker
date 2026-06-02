const $ = (selector) => document.querySelector(selector);
let allItems = [];

const APP_VERSION = chrome.runtime.getManifest().version;
const BACKUP_META_KEY = "appProgressBackupMeta";
const AUTO_BACKUP_KEY = "appProgressItemsAutoBackup";

function getLocal(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

function setLocal(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, resolve);
  });
}

function removeLocal(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
  });
}

function formatDateTime(value) {
  if (!value) return "未作成";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未作成";
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function buildBackupPayload(exportedAt = new Date().toISOString()) {
  return {
    app: "アプリ進行中",
    repository: "poi-app-tracker",
    version: 4,
    appVersion: APP_VERSION,
    exportedAt,
    storageKey: STORAGE_KEY,
    items: allItems
  };
}

async function getBackupMeta() {
  const result = await getLocal([BACKUP_META_KEY]);
  return result[BACKUP_META_KEY] && typeof result[BACKUP_META_KEY] === "object"
    ? result[BACKUP_META_KEY]
    : {};
}

async function setBackupMeta(meta) {
  await setLocal({ [BACKUP_META_KEY]: meta });
}

async function getAutoBackup() {
  const result = await getLocal([AUTO_BACKUP_KEY]);
  const snapshot = result[AUTO_BACKUP_KEY];
  if (!snapshot || !Array.isArray(snapshot.items)) return null;
  return snapshot;
}

async function saveAutoBackup(reason = "manual-safety") {
  const now = new Date().toISOString();
  const meta = await getBackupMeta();
  const snapshot = {
    app: "アプリ進行中",
    repository: "poi-app-tracker",
    snapshotType: reason,
    appVersion: APP_VERSION,
    previousSeenVersion: meta.lastSeenVersion || "",
    savedAt: now,
    storageKey: STORAGE_KEY,
    itemCount: allItems.length,
    items: allItems
  };

  await setLocal({ [AUTO_BACKUP_KEY]: snapshot });
  await setBackupMeta({
    ...meta,
    lastAutoSnapshotAt: now,
    lastAutoSnapshotVersion: APP_VERSION,
    lastAutoSnapshotItemCount: allItems.length
  });
  return snapshot;
}

async function markVersionSeenAndSnapshotIfNeeded() {
  const meta = await getBackupMeta();
  const existingSnapshot = await getAutoBackup();
  const versionChanged = meta.lastSeenVersion !== APP_VERSION;
  const missingAutoSnapshot = !existingSnapshot || !Array.isArray(existingSnapshot.items) || !existingSnapshot.items.length;
  const canCreateSnapshot = Array.isArray(allItems) && allItems.length > 0;

  if (!versionChanged && (!missingAutoSnapshot || !canCreateSnapshot)) return meta;

  const now = new Date().toISOString();
  const nextMeta = { ...meta };
  const valuesToSet = {};

  if (versionChanged) {
    nextMeta.lastSeenVersion = APP_VERSION;
    nextMeta.lastUpdateDetectedAt = now;
    nextMeta.lastUpdateDetectedVersion = APP_VERSION;
    nextMeta.previousSeenVersion = meta.lastSeenVersion || "";
    nextMeta.backupNoticeDismissedForVersion = "";
  }

  // 既存案件があるのに内部控えがない場合は、バージョン更新時でなくても初回一覧表示で作成する。
  // ただし案件が0件のときは、既存の内部控えを空データで上書きしない。
  if (canCreateSnapshot && (versionChanged || missingAutoSnapshot)) {
    const snapshot = {
      app: "アプリ進行中",
      repository: "poi-app-tracker",
      snapshotType: versionChanged ? "version-update" : "initial-auto-backup",
      appVersion: APP_VERSION,
      previousSeenVersion: meta.lastSeenVersion || "",
      savedAt: now,
      storageKey: STORAGE_KEY,
      itemCount: allItems.length,
      items: allItems
    };

    valuesToSet[AUTO_BACKUP_KEY] = snapshot;
    nextMeta.lastAutoSnapshotAt = now;
    nextMeta.lastAutoSnapshotVersion = APP_VERSION;
    nextMeta.lastAutoSnapshotItemCount = allItems.length;
  }

  valuesToSet[BACKUP_META_KEY] = nextMeta;
  await setLocal(valuesToSet);

  return nextMeta;
}

async function renderBackupSafety() {
  const meta = await getBackupMeta();
  const snapshot = await getAutoBackup();
  const notice = $("#backupSafetyNotice");
  const backupStatus = $("#backupStatus");
  const restoreButton = $("#restoreAutoBackup");

  const hasAutoBackup = !!snapshot && Array.isArray(snapshot.items) && snapshot.items.length > 0;
  restoreButton.hidden = !hasAutoBackup;
  restoreButton.disabled = !hasAutoBackup;

  const lastBackupText = meta.lastBackupAt
    ? `最終JSONバックアップ: ${formatDateTime(meta.lastBackupAt)} / ${meta.lastBackupItemCount || 0}件 / v${meta.lastBackupVersion || "不明"}`
    : "最終JSONバックアップ: 未作成";
  const autoBackupText = snapshot
    ? `内部控え: ${formatDateTime(snapshot.savedAt)} / ${snapshot.itemCount || snapshot.items.length}件 / v${snapshot.appVersion || "不明"}`
    : "内部控え: 未作成";
  backupStatus.textContent = `${lastBackupText}。${autoBackupText}。内部控えは拡張機能内の簡易バックアップです。削除・入れ直し・別PC移行の前はJSONバックアップを書き出してください。`;

  if (!allItems.length) {
    notice.hidden = true;
    return;
  }

  const dismissed = meta.backupNoticeDismissedForVersion === APP_VERSION;
  const noJsonBackup = !meta.lastBackupAt;
  const updatedNeedsBackup = meta.lastUpdateDetectedVersion === APP_VERSION
    && meta.lastBackupVersion !== APP_VERSION;

  if (dismissed || (!noJsonBackup && !updatedNeedsBackup)) {
    notice.hidden = true;
    return;
  }

  $("#backupSafetyTitle").textContent = noJsonBackup
    ? "バックアップ未作成です"
    : `v${APP_VERSION}に更新されました`;
  $("#backupSafetyText").textContent = noJsonBackup
    ? "案件データはこのChrome内に保存されています。拡張機能の削除、Chromeプロファイル変更、ストレージ削除に備えて、JSONバックアップを書き出しておくことをおすすめします。"
    : "通常の拡張機能更新でデータが消える想定ではありませんが、念のためJSONバックアップを書き出しておくことをおすすめします。";
  $("#backupSafetyMeta").textContent = `${autoBackupText}。内部控えはこの拡張機能の中に保存される簡易バックアップです。拡張機能を削除すると内部控えも一緒に消える場合があります。削除・入れ直し・別PC移行の前には、必ずJSONバックアップを書き出してください。`;
  notice.hidden = false;
}


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


function platformInfo(item) {
  const text = [
    item.appName,
    item.title,
    item.siteName,
    item.url,
    item.condition,
    item.memo,
    item.progress,
    logsToText(item)
  ].join(" ");
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[＿_./?&=+#%:;|()[\]{}]/g, " ")
    .replace(/[\s\-]+/g, " ")
    .trim();

  const hasIos = /(^|\s)(ios|iphone|ipad|apple)(\s|$)/.test(normalized)
    || normalized.includes("app store")
    || normalized.includes("itunes");
  const hasAndroid = /(^|\s)(android|apk)(\s|$)/.test(normalized)
    || normalized.includes("google play")
    || normalized.includes("play google");

  if (hasIos && hasAndroid) return { value: "both", label: "iOS + Android", className: "both" };
  if (hasIos) return { value: "ios", label: "iOS", className: "ios" };
  if (hasAndroid) return { value: "android", label: "Android", className: "android" };
  return { value: "unknown", label: "OS未判定", className: "unknown" };
}

function matchesPlatform(item, selectedPlatform) {
  if (!selectedPlatform) return true;
  const platform = platformInfo(item).value;
  if (selectedPlatform === "ios") return platform === "ios" || platform === "both";
  if (selectedPlatform === "android") return platform === "android" || platform === "both";
  return platform === selectedPlatform;
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

async function exportJson() {
  const exportedAt = new Date().toISOString();
  const payload = buildBackupPayload(exportedAt);
  downloadText(
    `poi-app-tracker-backup-${exportedAt.slice(0, 10)}.json`,
    JSON.stringify(payload, null, 2),
    "application/json;charset=utf-8"
  );

  const meta = await getBackupMeta();
  await setBackupMeta({
    ...meta,
    lastSeenVersion: APP_VERSION,
    lastBackupAt: exportedAt,
    lastBackupVersion: APP_VERSION,
    lastBackupItemCount: allItems.length,
    backupNoticeDismissedForVersion: APP_VERSION
  });
  $("#backupMessage").textContent = "バックアップJSONを出力しました。";
  await renderBackupSafety();
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
  const platform = $("#platformFilter").value;
  const sortMode = $("#sortMode").value;

  const filtered = allItems.filter((item) => {
    const platformDetected = platformInfo(item);
    const haystack = [
      item.appName,
      item.title,
      item.siteName,
      item.memo,
      item.condition,
      item.progress,
      item.inquiryNo,
      logsToText(item),
      platformDetected.label,
      platformDetected.value
    ]
      .join(" ")
      .toLowerCase();
    return (!query || haystack.includes(query))
      && (!status || item.status === status)
      && matchesPlatform(item, platform);
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
    const platform = platformInfo(item);
    const log = latestLog(item);
    return `
      <article class="item-card ${info.className === "expired" ? "is-expired" : ""}">
        <div class="item-main">
          <div class="item-title">${escapeHtml(title)}</div>
          <div class="item-meta">
            <span>サイト：${escapeHtml(item.siteName || "未入力")}</span>
            <span>報酬：${escapeHtml(item.reward || "未入力")}</span>
            <span class="platform-pill ${escapeHtml(platform.className)}">${escapeHtml(platform.label)}</span>
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
      await saveAutoBackup("before-delete");
      await deleteItem(button.dataset.delete);
      allItems = await getItems();
      render();
      await renderBackupSafety();
    });
  });
}

async function load() {
  allItems = await getItems();
  await markVersionSeenAndSnapshotIfNeeded();
  render();
  await renderBackupSafety();
}

$("#search").addEventListener("input", render);
$("#statusFilter").addEventListener("change", render);
$("#platformFilter").addEventListener("change", render);
$("#sortMode").addEventListener("change", render);
$("#exportCsv").addEventListener("click", exportCsv);
$("#exportJson").addEventListener("click", () => exportJson());
$("#backupSafetyExport").addEventListener("click", () => exportJson());
$("#backupSafetyLater").addEventListener("click", async () => {
  const meta = await getBackupMeta();
  await setBackupMeta({ ...meta, backupNoticeDismissedForVersion: APP_VERSION });
  await renderBackupSafety();
  $("#backupMessage").textContent = "バックアップ案内をいったん閉じました。JSON出力ボタンはいつでも使えます。";
});
$("#restoreAutoBackup").addEventListener("click", async () => {
  const snapshot = await getAutoBackup();
  if (!snapshot || !Array.isArray(snapshot.items) || !snapshot.items.length) {
    $("#backupMessage").textContent = "復元できる内部控えがありません。";
    return;
  }
  const label = `${formatDateTime(snapshot.savedAt)} / ${snapshot.items.length}件`;
  if (!confirm(`内部控え（${label}）で現在の案件データを置き換えます。よろしいですか？`)) return;
  await saveAutoBackup("before-auto-backup-restore");
  const count = await replaceItems(snapshot.items);
  allItems = await getItems();
  render();
  await renderBackupSafety();
  $("#backupMessage").textContent = `内部控えから${count}件を復元しました。`;
});
$("#importJson").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const imported = parseImportJson(text);
    if (!confirm(`現在の案件データを、読み込んだ${imported.length}件のデータで置き換えます。よろしいですか？`)) return;
    await saveAutoBackup("before-json-import");
    const count = await replaceItems(imported);
    allItems = await getItems();
    render();
    await renderBackupSafety();
    $("#backupMessage").textContent = `${count}件のデータを復元しました。復元前の内部控えも保存しています。`;
  } catch (error) {
    $("#backupMessage").textContent = `復元できませんでした: ${error.message}`;
  } finally {
    event.target.value = "";
  }
});

load();

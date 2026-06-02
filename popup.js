const $ = (selector) => document.querySelector(selector);

const STORAGE_KEY = "appProgressItems";
const BACKUP_META_KEY = "appProgressBackupMeta";
const APP_VERSION = chrome.runtime.getManifest().version;

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function buildNewUrl(tab) {
  const params = new URLSearchParams({
    title: tab.title || "",
    url: tab.url || ""
  });
  return chrome.runtime.getURL(`edit.html?${params.toString()}`);
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
    await chrome.tabs.create({ url: buildNewUrl(tab) });
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

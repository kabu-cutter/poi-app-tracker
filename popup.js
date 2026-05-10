const $ = (selector) => document.querySelector(selector);

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

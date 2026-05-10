const STORAGE_KEY = "appProgressItems";

function getItems() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
    });
  });
}

function setItems(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: items }, resolve);
  });
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeLogs(logs) {
  if (!Array.isArray(logs)) return [];
  return logs
    .map((log) => ({
      id: log.id || createId(),
      date: log.date || "",
      text: log.text || "",
      createdAt: log.createdAt || new Date().toISOString()
    }))
    .filter((log) => log.date || log.text)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function normalizeItem(item) {
  const now = new Date().toISOString();
  return {
    id: item.id || createId(),
    appName: item.appName || "",
    title: item.title || "",
    siteName: item.siteName || "",
    reward: item.reward || "",
    url: item.url || "",
    installDate: item.installDate || "",
    startDate: item.startDate || "",
    deadline: item.deadline || "",
    status: item.status || "進行中",
    progress: item.progress || "",
    inquiryNo: item.inquiryNo || "",
    condition: item.condition || "",
    memo: item.memo || "",
    logs: normalizeLogs(item.logs),
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now
  };
}

async function saveItem(item) {
  const items = await getItems();
  const now = new Date().toISOString();

  if (item.id) {
    const index = items.findIndex((entry) => entry.id === item.id);
    if (index >= 0) {
      items[index] = normalizeItem({
        ...items[index],
        ...item,
        updatedAt: now
      });
    } else {
      items.push(normalizeItem({ ...item, createdAt: now, updatedAt: now }));
    }
  } else {
    items.push(normalizeItem({
      ...item,
      id: createId(),
      createdAt: now,
      updatedAt: now
    }));
  }

  await setItems(items);
}

async function deleteItem(id) {
  const items = await getItems();
  await setItems(items.filter((item) => item.id !== id));
}

async function findItem(id) {
  const items = await getItems();
  return items.find((item) => item.id === id) || null;
}

async function replaceItems(importedItems) {
  const normalized = (Array.isArray(importedItems) ? importedItems : []).map(normalizeItem);
  await setItems(normalized);
  return normalized.length;
}

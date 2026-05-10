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

function getParams() {
  return new URLSearchParams(location.search);
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
  } else {
    const title = params.get("title") || "";
    const url = params.get("url") || "";
    setValue("title", title);
    setValue("appName", guessAppName(title));
    setValue("siteName", guessSiteName(url));
    setValue("url", url);
    const today = new Date().toISOString().slice(0, 10);
    setValue("installDate", today);
    setValue("startDate", today);
  }

  updatePreview();
}

fields.forEach((field) => {
  const element = $(`#${field}`);
  if (element) element.addEventListener("input", updatePreview);
});

$("#itemForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const item = Object.fromEntries(fields.map((field) => [field, getValue(field)]));
  await saveItem(item);
  $("#message").textContent = "保存しました。";
  setTimeout(() => {
    location.href = "list.html";
  }, 500);
});

load();

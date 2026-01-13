// extension/utils/constants.ts
var STORAGE_KEYS = {
  ANALYTICS: "apg_analytics"
};
var UI_LIMITS = {
  MAX_TOP_HOSTS: 8,
  MAX_TOP_CATEGORIES: 10,
  MAX_DAILY_POINTS: 14
  // last N days
};
var EXPORT = {
  FILENAME_PREFIX: "apg-analytics"
};

// extension/ui/dashboard.ts
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.appendChild(c);
  return node;
}
function text(t) {
  return document.createTextNode(t);
}
function sortEntries(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]);
}
function formatDateKey(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function lastNDaysKeys(n) {
  const keys = [];
  const now = /* @__PURE__ */ new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    keys.push(formatDateKey(d));
  }
  return keys;
}
async function loadAnalytics() {
  var _a;
  const res = await chrome.storage.local.get(STORAGE_KEYS.ANALYTICS);
  return (_a = res[STORAGE_KEYS.ANALYTICS]) != null ? _a : null;
}
function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function card(title, body) {
  return el("div", { class: "card" }, [el("h2", {}, [text(title)]), body]);
}
function kvRow(label, value) {
  return el("div", { class: "kv" }, [
    el("div", { class: "k" }, [text(label)]),
    el("div", { class: "v" }, [text(value)])
  ]);
}
function listTop(obj, limit) {
  const entries = sortEntries(obj).slice(0, limit);
  if (entries.length === 0) return el("div", { class: "muted" }, [text("No data yet.")]);
  const ul = el("ul", { class: "list" });
  for (const [k, v] of entries) {
    ul.appendChild(el("li", {}, [text(`${k}: ${v}`)]));
  }
  return ul;
}
function renderEmpty(root) {
  root.innerHTML = "";
  root.appendChild(
    el("div", { class: "empty" }, [
      el("h1", {}, [text("Privacy Guard \u2014 Analytics")]),
      el("p", { class: "muted" }, [
        text("No analytics yet. Trigger a warning on a supported AI site to generate data.")
      ])
    ])
  );
}
function renderDashboard(root, store) {
  var _a, _b, _c;
  root.innerHTML = "";
  const header = el("div", { class: "header" }, [
    el("div", {}, [
      el("h1", {}, [text("Privacy Guard \u2014 Analytics")]),
      el("p", { class: "muted" }, [
        text("Counts only. No prompt content is sto  or transmitted.")
      ])
    ])
  ]);
  const totalsBody = el("div", {}, [
    kvRow("Warnings triggered", String(store.warningsTotal)),
    kvRow("Actions: continue", String((_a = store.byAction.continue) != null ? _a : 0))
  ]);
  const topHostsBody = listTop((_b = store.byHost) != null ? _b : {}, UI_LIMITS.MAX_TOP_HOSTS);
  const topCatsBody = listTop((_c = store.byCategory) != null ? _c : {}, UI_LIMITS.MAX_TOP_CATEGORIES);
  const trendKeys = lastNDaysKeys(UI_LIMITS.MAX_DAILY_POINTS);
  const trendBody = el("div", {}, [
    el("div", { class: "muted small" }, [text(`Last ${trendKeys.length} days`)]),
    el("ul", { class: "list" }, trendKeys.map((k) => {
      var _a2, _b2;
      const v = (_b2 = (_a2 = store.daily) == null ? void 0 : _a2[k]) != null ? _b2 : 0;
      return el("li", {}, [text(`${k}: ${v}`)]);
    }))
  ]);
  const exportBtn = el("button", { class: "btn" }, [text("Export anonymized JSON")]);
  exportBtn.addEventListener("click", () => {
    const ts = /* @__PURE__ */ new Date();
    const stamp = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;
    downloadJson(`${EXPORT.FILENAME_PREFIX}-${stamp}.json`, store);
  });
  const exportBody = el("div", {}, [
    el("p", { class: "muted" }, [
      text("Export includes only aggregated counts (no prompt text).")
    ]),
    exportBtn
  ]);
  const grid = el("div", { class: "grid" }, [
    card("Totals", totalsBody),
    card("Top hosts", topHostsBody),
    card("Top categories", topCatsBody),
    card("Trend", trendBody),
    card("Export", exportBody)
  ]);
  root.appendChild(header);
  root.appendChild(grid);
}
async function initDashboard() {
  const root = document.getElementById("root");
  if (!root) return;
  const store = await loadAnalytics();
  if (!store) return renderEmpty(root);
  renderDashboard(root, store);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!changes[STORAGE_KEYS.ANALYTICS]) return;
    const next = changes[STORAGE_KEYS.ANALYTICS].newValue;
    if (!next) renderEmpty(root);
    else renderDashboard(root, next);
  });
}
export {
  initDashboard
};
//# sourceMappingURL=dashboard.js.map

"use strict";
(() => {
  // extension/background/storage.ts
  var STORAGE_KEY = "apg_analytics";
  function todayKey(ts) {
    const d = new Date(ts);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  function defaultStore() {
    return {
      version: 1,
      warningsTotal: 0,
      byHost: {},
      byCategory: {},
      byAction: { redact: 0, continue: 0, cancel: 0 },
      bySource: { paste: 0, send: 0 },
      byRiskLevel: { WARN: 0, BLOCK: 0 },
      daily: {}
    };
  }
  async function getStore() {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    const existing = res[STORAGE_KEY];
    if (!existing) return defaultStore();
    if (existing.version !== 1) {
      return defaultStore();
    }
    return existing;
  }
  async function setStore(store) {
    await chrome.storage.local.set({ [STORAGE_KEY]: store });
  }
  function inc(obj, key, amt = 1) {
    var _a;
    obj[key] = ((_a = obj[key]) != null ? _a : 0) + amt;
  }
  async function applyEvent(ev) {
    var _a, _b, _c;
    const store = await getStore();
    store.warningsTotal += 1;
    inc(store.byHost, ev.host);
    for (const cat of ev.categories) inc(store.byCategory, cat);
    store.byAction[ev.action] = ((_a = store.byAction[ev.action]) != null ? _a : 0) + 1;
    store.bySource[ev.source] = ((_b = store.bySource[ev.source]) != null ? _b : 0) + 1;
    store.byRiskLevel[ev.riskLevel] = ((_c = store.byRiskLevel[ev.riskLevel]) != null ? _c : 0) + 1;
    const day = todayKey(ev.ts);
    inc(store.daily, day);
    await setStore(store);
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const msg = message;
    if ((msg == null ? void 0 : msg.type) !== "APG_ANALYTICS_EVENT" || !msg.payload) {
      return false;
    }
    applyEvent(msg.payload).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: String(err) })
    );
    return true;
  });
})();
//# sourceMappingURL=storage.js.map

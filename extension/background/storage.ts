type RiskLevel = "ALLOW" | "WARN" | "BLOCK";
type ModalChoice = "redact" | "continue" | "cancel";
type PromptEventSource = "paste" | "send";

type AnalyticsEvent = {
  type: "APG_ANALYTICS_EVENT";
  payload: {
    ts: number; // unix ms
    host: string; // e.g. chat.openai.com
    source: PromptEventSource; // paste or send
    riskLevel: Exclude<RiskLevel, "ALLOW">; // only WARN/BLOCK are logged
    riskScore: number; // 0..1
    categories: string[]; // e.g. ["API_KEY","EMAIL"] (no content)
    action: ModalChoice; // redact/continue/cancel
  };
};

type AnalyticsStoreV1 = {
  version: 1;

  // totals
  warningsTotal: number; // WARN + BLOCK events

  // breakdowns
  byHost: Record<string, number>;
  byCategory: Record<string, number>;
  byAction: Record<ModalChoice, number>;
  bySource: Record<PromptEventSource, number>;
  byRiskLevel: Record<Exclude<RiskLevel, "ALLOW">, number>;

  // time series (simple daily buckets)
  daily: Record<string, number>; // YYYY-MM-DD -> count
};

const STORAGE_KEY = "apg_analytics";

function todayKey(ts: number): string {
  const d = new Date(ts);
  // YYYY-MM-DD in local time
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function defaultStore(): AnalyticsStoreV1 {
  return {
    version: 1,
    warningsTotal: 0,
    byHost: {},
    byCategory: {},
    byAction: { redact: 0, continue: 0, cancel: 0 },
    bySource: { paste: 0, send: 0 },
    byRiskLevel: { WARN: 0, BLOCK: 0 },
    daily: {},
  };
}

async function getStore(): Promise<AnalyticsStoreV1> {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  const existing = res[STORAGE_KEY] as AnalyticsStoreV1 | undefined;

  if (!existing) return defaultStore();

  // Simple versioning hook for future migrations
  if (existing.version !== 1) {
    // If somehow future/unknown, reset safely
    return defaultStore();
  }

  return existing;
}

async function setStore(store: AnalyticsStoreV1): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: store });
}

function inc(obj: Record<string, number>, key: string, amt = 1) {
  obj[key] = (obj[key] ?? 0) + amt;
}

async function applyEvent(ev: AnalyticsEvent["payload"]) {
  const store = await getStore();

  store.warningsTotal += 1;

  inc(store.byHost, ev.host);
  for (const cat of ev.categories) inc(store.byCategory, cat);

  store.byAction[ev.action] = (store.byAction[ev.action] ?? 0) + 1;
  store.bySource[ev.source] = (store.bySource[ev.source] ?? 0) + 1;
  store.byRiskLevel[ev.riskLevel] = (store.byRiskLevel[ev.riskLevel] ?? 0) + 1;

  const day = todayKey(ev.ts);
  inc(store.daily, day);

  await setStore(store);
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as Partial<AnalyticsEvent>;

  if (msg?.type !== "APG_ANALYTICS_EVENT" || !msg.payload) {
    // Not ours
    return false;
  }

  // Fire-and-forget async work; respond immediately
  applyEvent(msg.payload).then(
    () => sendResponse({ ok: true }),
    (err) => sendResponse({ ok: false, error: String(err) })
  );

  return true; // indicates async response
});

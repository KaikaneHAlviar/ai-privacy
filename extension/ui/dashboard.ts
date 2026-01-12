// extension/ui/dashboard.ts

import { EXPORT, STORAGE_KEYS, UI_LIMITS } from "../utils/constants";

type ModalChoice = "redact" | "continue";
type PromptEventSource = "paste" | "send";
type WarnLevel = "WARN" | "BLOCK";

type AnalyticsStoreV1 = {
  version: 1;
  warningsTotal: number;

  byHost: Record<string, number>;
  byCategory: Record<string, number>;
  byAction: Record<ModalChoice, number>;
  bySource: Record<PromptEventSource, number>;
  byRiskLevel: Record<WarnLevel, number>;

  daily: Record<string, number>; // YYYY-MM-DD -> count
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Array<HTMLElement | Text> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.appendChild(c);
  return node;
}

function text(t: string) {
  return document.createTextNode(t);
}

function sortEntries(obj: Record<string, number>) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]);
}

function formatDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function lastNDaysKeys(n: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    keys.push(formatDateKey(d));
  }
  return keys;
}

async function loadAnalytics(): Promise<AnalyticsStoreV1 | null> {
  const res = await chrome.storage.local.get(STORAGE_KEYS.ANALYTICS);
  return (res[STORAGE_KEYS.ANALYTICS] as AnalyticsStoreV1 | undefined) ?? null;
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function card(title: string, body: HTMLElement) {
  return el("div", { class: "card" }, [el("h2", {}, [text(title)]), body]);
}

function kvRow(label: string, value: string) {
  return el("div", { class: "kv" }, [
    el("div", { class: "k" }, [text(label)]),
    el("div", { class: "v" }, [text(value)]),
  ]);
}

function listTop(obj: Record<string, number>, limit: number) {
  const entries = sortEntries(obj).slice(0, limit);
  if (entries.length === 0) return el("div", { class: "muted" }, [text("No data yet.")]);

  const ul = el("ul", { class: "list" });
  for (const [k, v] of entries) {
    ul.appendChild(el("li", {}, [text(`${k}: ${v}`)]));
  }
  return ul;
}

function renderEmpty(root: HTMLElement) {
  root.innerHTML = "";
  root.appendChild(
    el("div", { class: "empty" }, [
      el("h1", {}, [text("Privacy Guard — Analytics")]),
      el("p", { class: "muted" }, [
        text("No analytics yet. Trigger a warning on a supported AI site to generate data."),
      ]),
    ])
  );
}

function renderDashboard(root: HTMLElement, store: AnalyticsStoreV1) {
  root.innerHTML = "";

  const header = el("div", { class: "header" }, [
    el("div", {}, [
      el("h1", {}, [text("Privacy Guard — Analytics")]),
      el("p", { class: "muted" }, [
        text("Counts only. No prompt content is stored or transmitted."),
      ]),
    ]),
  ]);

  const totalsBody = el("div", {}, [
    kvRow("Warnings triggered", String(store.warningsTotal)),
    kvRow("Actions: redact", String(store.byAction.redact ?? 0)),
    kvRow("Actions: continue", String(store.byAction.continue ?? 0)),
  ]);

  const topHostsBody = listTop(store.byHost ?? {}, UI_LIMITS.MAX_TOP_HOSTS);
  const topCatsBody = listTop(store.byCategory ?? {}, UI_LIMITS.MAX_TOP_CATEGORIES);

  const trendKeys = lastNDaysKeys(UI_LIMITS.MAX_DAILY_POINTS);
  const trendBody = el("div", {}, [
    el("div", { class: "muted small" }, [text(`Last ${trendKeys.length} days`)]),
    el("ul", { class: "list" }, trendKeys.map((k) => {
      const v = store.daily?.[k] ?? 0;
      return el("li", {}, [text(`${k}: ${v}`)]);
    })),
  ]);

  const exportBtn = el("button", { class: "btn" }, [text("Export anonymized JSON")]);
  exportBtn.addEventListener("click", () => {
    const ts = new Date();
    const stamp =
      `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;
    downloadJson(`${EXPORT.FILENAME_PREFIX}-${stamp}.json`, store);
  });

  const exportBody = el("div", {}, [
    el("p", { class: "muted" }, [
      text("Export includes only aggregated counts (no prompt text)."),
    ]),
    exportBtn,
  ]);

  const grid = el("div", { class: "grid" }, [
    card("Totals", totalsBody),
    card("Top hosts", topHostsBody),
    card("Top categories", topCatsBody),
    card("Trend", trendBody),
    card("Export", exportBody),
  ]);

  root.appendChild(header);
  root.appendChild(grid);
}

export async function initDashboard() {
  const root = document.getElementById("root");
  if (!root) return;

  const store = await loadAnalytics();
  if (!store) return renderEmpty(root);

  renderDashboard(root, store);

  // Live update when storage changes (nice UX)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!changes[STORAGE_KEYS.ANALYTICS]) return;

    const next = changes[STORAGE_KEYS.ANALYTICS].newValue as AnalyticsStoreV1 | undefined;
    if (!next) renderEmpty(root);
    else renderDashboard(root, next);
  });
}

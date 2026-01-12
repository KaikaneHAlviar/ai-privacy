// extension/content/interceptor.ts
// WARNING-ONLY version: no redaction, no text insertion

import { scanTextForRisk } from "../detectors/classifier";
import { showWarningModal } from "../ui/modal";

type InputLike = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

const AI_INPUT_SELECTOR_CANDIDATES = ["textarea", "[contenteditable='true']"];

// Prevent re-entrancy (e.g., paste triggers, keydown triggers, site handlers fire twice)
let modalOpen = false;

function safeHost(): string {
  try {
    return window.location.host || "unknown";
  } catch {
    return "unknown";
  }
}

function toCategories(result: { hits: Array<{ category: string }> }): string[] {
  // only categories, never text
  return Array.from(new Set(result.hits.map((h) => h.category))).slice(0, 12);
}

async function logAnalyticsEvent(args: {
  source: "paste" | "send";
  riskLevel: "WARN" | "BLOCK";
  riskScore: number;
  categories: string[];
  action: "continue";
}) {
  try {
    await chrome.runtime.sendMessage({
      type: "APG_ANALYTICS_EVENT",
      payload: {
        ts: Date.now(),
        host: safeHost(),
        source: args.source,
        riskLevel: args.riskLevel,
        riskScore: args.riskScore,
        categories: args.categories,
        action: args.action,
      },
    });
  } catch {
    // ignore; content scripts can run before SW wakes
  }
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isEditableTarget(el: HTMLElement): el is HTMLElement {
  return (
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLInputElement ||
    el.isContentEditable
  );
}

function getTextFromInput(el: InputLike): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.value ?? "";
  }
  return (el as HTMLElement).innerText ?? "";
}

function findActiveAIInput(): InputLike | null {
  // Prefer focused element if it’s editable
  const active = document.activeElement as HTMLElement | null;
  if (active && isEditableTarget(active) && isVisible(active)) {
    return active as InputLike;
  }

  // Fallback to scanning candidates
  for (const selector of AI_INPUT_SELECTOR_CANDIDATES) {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
    for (const node of nodes) {
      if (!isVisible(node)) continue;
      if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) return node;
      if (node.isContentEditable) return node;
    }
  }
  return null;
}

async function maybeWarn(text: string, source: "paste" | "send") {
  const result = scanTextForRisk(text);
  if (result.riskLevel === "ALLOW") return { action: "allow" as const, result };

  modalOpen = true;
  try {
    const choice = await showWarningModal({
      riskLevel: result.riskLevel,
      riskScore: result.riskScore,
      explanation: result.explanation,
    });

    // TODO: review change — warning-only mode; modal returns only "continue" for WARN/BLOCK
    await logAnalyticsEvent({
      source,
      riskLevel: result.riskLevel, // WARN | BLOCK
      riskScore: result.riskScore,
      categories: toCategories(result),
      action: choice,
    });

    return { action: choice, result };
  } finally {
    modalOpen = false;
  }
}

async function handleTextSubmission(el: InputLike): Promise<boolean> {
  const text = getTextFromInput(el);
  if (!text || text.trim().length < 4) return true;

  const { action } = await maybeWarn(text, "send");

  // WARNING-ONLY: we never modify or block sends; we only warn then allow.
  // TODO: review change — if you later reintroduce a "cancel" action, return false here.
  return action === "allow" || action === "continue";
}

/**
 * Intercept paste events
 *
 * WARNING-ONLY: we DO NOT preventDefault or insert anything.
 * We simply warn, then allow the native paste behavior to proceed.
 */
document.addEventListener(
  "paste",
  async (e) => {
    if (modalOpen) return;

    const target = e.target as HTMLElement | null;
    if (!target || !isEditableTarget(target)) return;

    const pastedText = e.clipboardData?.getData("text");
    if (!pastedText) return;

    // WARNING-ONLY: do not block paste; do not modify text.
    await maybeWarn(pastedText, "paste");
  },
  true // capture: we want to run before site handlers
);

/**
 * Intercept Enter-to-send
 *
 * Notes:
 * - Shift+Enter should insert newline -> we do nothing
 * - Some sites use Ctrl/Cmd+Enter to send. We treat plain Enter as send-like and scan.
 * - WARNING-ONLY: we do not block the send; we only warn.
 */
document.addEventListener(
  "keydown",
  async (e) => {
    if (modalOpen) return;
    if (e.key !== "Enter") return;
    if (e.shiftKey) return;

    // If user is composing IME text, don’t interfere
    if ((e as any).isComposing) return;

    const active = findActiveAIInput();
    if (!active) return;

    // Only act if the focused element is the active input
    const focused = document.activeElement as HTMLElement | null;
    if (focused && focused !== active && !active.contains(focused)) return;

    // WARNING-ONLY: show warning if needed, but do not prevent default send behavior.
    await handleTextSubmission(active);
  },
  true // capture so we can prevent before app handlers send
);

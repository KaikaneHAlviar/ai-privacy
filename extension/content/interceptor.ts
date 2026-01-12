// extension/content/interceptor.ts

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
  action: "redact" | "continue";
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

function setTextToInput(el: InputLike, text: string) {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    (el as HTMLElement).innerText = text;
    (el as HTMLElement).dispatchEvent(new Event("input", { bubbles: true }));
  }
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

/**
 * Insert text at caret for <textarea>/<input>
 */
function insertTextIntoTextControl(
  el: HTMLTextAreaElement | HTMLInputElement,
  insertText: string
) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;

  const before = el.value.slice(0, start);
  const after = el.value.slice(end);

  el.value = before + insertText + after;

  const newPos = start + insertText.length;
  el.setSelectionRange(newPos, newPos);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Insert text at caret for contenteditable elements using Selection/Range
 */
function insertTextIntoContentEditable(el: HTMLElement, insertText: string) {
  const sel = window.getSelection();
  if (!sel) {
    // fallback: append
    el.innerText = (el.innerText ?? "") + insertText;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  // Ensure selection is within this element
  if (sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
    // focus and append at end
    el.focus();
    el.innerText = (el.innerText ?? "") + insertText;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  const range = sel.getRangeAt(0);
  range.deleteContents();

  const textNode = document.createTextNode(insertText);
  range.insertNode(textNode);

  // Move caret after inserted text node
  range.setStartAfter(textNode);
  range.collapse(true);

  sel.removeAllRanges();
  sel.addRange(range);

  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function insertTextAtCaret(target: HTMLElement, insertText: string) {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    insertTextIntoTextControl(target, insertText);
    return;
  }
  if (target.isContentEditable) {
    insertTextIntoContentEditable(target, insertText);
    return;
  }

  // no-op fallback
}

/**
 * Redact based on hit examples (v1 naive)
 */
function applyNaiveRedaction(original: string, examples: string[] | undefined): string {
  if (!examples || examples.length === 0) return original;
  let redacted = original;
  for (const ex of examples) {
    // ex strings might already be partially redacted; still useful as a token marker
    redacted = redacted.split(ex).join("[REDACTED]");
  }
  return redacted;
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

    // Log analytics for WARN/BLOCK only (no prompt content)
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

    const { action, result } = await maybeWarn(text, "send");
  if (action === "allow" || action === "continue") return true;

  // redact
  let redacted = text;
  for (const hit of result.hits) {
    redacted = applyNaiveRedaction(redacted, hit.examples);
  }
  setTextToInput(el, redacted);
  return true;
}

/**
 * Intercept paste events (caret-aware)
 */
document.addEventListener(
  "paste",
  async (e) => {
    if (modalOpen) return;

    const target = e.target as HTMLElement | null;
    if (!target || !isEditableTarget(target)) return;

    const pastedText = e.clipboardData?.getData("text");
    if (!pastedText) return;

    const { action, result } = await maybeWarn(pastedText, "paste");
    if (action === "allow") return;

    // We are taking over the paste
    e.preventDefault();
    e.stopPropagation();
    // (stopImmediatePropagation is safe here: we’re intentionally overriding)
    (e as any).stopImmediatePropagation?.();

    if (action === "continue") return;

    let finalText = pastedText;
    if (action === "redact") {
      for (const hit of result.hits) {
        finalText = applyNaiveRedaction(finalText, hit.examples);
      }
    }

    insertTextAtCaret(target, finalText);
  },
  true // capture: we want to run before site handlers
);

/**
 * Intercept Enter-to-send
 *
 * Notes:
 * - Shift+Enter should insert newline -> we do nothing
 * - Some sites use Ctrl/Cmd+Enter to send. We treat plain Enter as send-like and scan.
 * - We only block the event if user cancels.
 */
document.addEventListener(
  "keydown",
  async (e) => {
    if (modalOpen) return;
    if (e.key !== "Enter") return;
    if (e.shiftKey) return;

    // If user is composing IME text, don’t interfere
    // (TS typing: KeyboardEvent has isComposing in modern DOM libs)
    if ((e as any).isComposing) return;

    const active = findActiveAIInput();
    if (!active) return;

    // Only act if the focused element is the active input
    const focused = document.activeElement as HTMLElement | null;
    if (focused && focused !== active && !active.contains(focused)) return;

    const shouldContinue = await handleTextSubmission(active);

    if (!shouldContinue) {
      e.preventDefault();
      e.stopPropagation();
      (e as any).stopImmediatePropagation?.();
    }
  },
  true // capture so we can prevent before app handlers send
);

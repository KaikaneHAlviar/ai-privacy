// extension/ui/modal.ts
// WARNING-ONLY version: no redaction, no text insertion

export type ModalChoice = "continue";
export type ModalRiskLevel = "ALLOW" | "WARN" | "BLOCK";

export interface WarningModalArgs {
  riskLevel: ModalRiskLevel;
  riskScore: number; // 0..1
  explanation: string[];
}

const OVERLAY_ID = "__ai_privacy_guard_overlay__";
const STYLE_ID = "__ai_privacy_guard_style__";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(0,0,0,0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
    }
    #${OVERLAY_ID} .apg-modal {
      width: min(560px, 100%);
      background: #0b0d12;
      color: #f5f7ff;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5);
      overflow: hidden;
    }
    #${OVERLAY_ID} .apg-header {
      padding: 16px 18px 10px 18px;
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }
    #${OVERLAY_ID} .apg-icon {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      display: grid;
      place-items: center;
      background: rgba(255,255,255,0.08);
      flex: 0 0 auto;
      margin-top: 2px;
    }
    #${OVERLAY_ID} .apg-title {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.2;
      margin: 0;
    }
    #${OVERLAY_ID} .apg-subtitle {
      margin: 6px 0 0 0;
      color: rgba(245,247,255,0.75);
      font-size: 13px;
      line-height: 1.35;
    }
    #${OVERLAY_ID} .apg-body {
      padding: 0 18px 14px 18px;
    }
    #${OVERLAY_ID} .apg-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.06);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      color: rgba(245,247,255,0.85);
      margin-top: 8px;
    }
    #${OVERLAY_ID} .apg-list {
      margin: 12px 0 0 0;
      padding: 0 0 0 18px;
      color: rgba(245,247,255,0.85);
      font-size: 13px;
      line-height: 1.45;
    }
    #${OVERLAY_ID} .apg-footer {
      padding: 14px 18px 18px 18px;
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      border-top: 1px solid rgba(255,255,255,0.10);
      background: rgba(255,255,255,0.03);
      flex-wrap: wrap;
    }
    #${OVERLAY_ID} .apg-btn {
      appearance: none;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.06);
      color: #f5f7ff;
      padding: 10px 12px;
      border-radius: 12px;
      font-weight: 650;
      font-size: 13px;
      cursor: pointer;
    }
    #${OVERLAY_ID} .apg-btn:hover { background: rgba(255,255,255,0.10); }
    #${OVERLAY_ID} .apg-btn:focus { outline: 2px solid rgba(124,92,255,0.75); outline-offset: 2px; }

    #${OVERLAY_ID} .apg-btn-primary {
      border-color: rgba(124,92,255,0.55);
      background: rgba(124,92,255,0.25);
    }
    #${OVERLAY_ID} .apg-btn-primary:hover { background: rgba(124,92,255,0.35); }

    #${OVERLAY_ID} .apg-btn-danger {
      border-color: rgba(255,88,88,0.50);
      background: rgba(255,88,88,0.18);
    }
    #${OVERLAY_ID} .apg-btn-danger:hover { background: rgba(255,88,88,0.28); }

    #${OVERLAY_ID} .apg-kbd {
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.06);
      border-bottom-color: rgba(255,255,255,0.22);
      padding: 2px 6px;
      border-radius: 8px;
      font-size: 11px;
      color: rgba(245,247,255,0.8);
    }
  `;
  document.head.appendChild(style);
}

function formatPercent01(x: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, x)) * 100);
  return `${pct}%`;
}

function iconForLevel(level: ModalRiskLevel): string {
  if (level === "BLOCK") return "⛔";
  return "⚠️";
}

function titleForLevel(level: ModalRiskLevel): string {
  if (level === "BLOCK") return "Sensitive data likely detected";
  return "Potential sensitive data detected";
}

function subtitleForLevel(level: ModalRiskLevel): string {
  if (level === "BLOCK") {
    return "This looks like high-risk content (e.g., private keys). Consider redacting before sending.";
  }
  return "Review what was detected before sending this to an AI tool.";
}

function removeExistingOverlay() {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  const selectors = [
    "button",
    "[href]",
    "input",
    "select",
    "textarea",
    "[tabindex]:not([tabindex='-1'])",
  ];
  return Array.from(container.querySelectorAll<HTMLElement>(selectors.join(","))).filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1
  );
}

export function showWarningModal(args: WarningModalArgs): Promise<ModalChoice> {
  ensureStyles();
  removeExistingOverlay();

  return new Promise<ModalChoice>((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;

    // Clicking outside cancels (safer default)
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) {
        cleanup("continue");
      }
    });

    const modal = document.createElement("div");
    modal.className = "apg-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", titleForLevel(args.riskLevel));

    const header = document.createElement("div");
    header.className = "apg-header";

    const icon = document.createElement("div");
    icon.className = "apg-icon";
    icon.textContent = iconForLevel(args.riskLevel);

    const headerText = document.createElement("div");

    const title = document.createElement("p");
    title.className = "apg-title";
    title.textContent = titleForLevel(args.riskLevel);

    const subtitle = document.createElement("p");
    subtitle.className = "apg-subtitle";
    subtitle.textContent = subtitleForLevel(args.riskLevel);

    const pill = document.createElement("div");
    pill.className = "apg-pill";
    pill.textContent = `Risk confidence: ${formatPercent01(args.riskScore)} • Press `;
    const kbd = document.createElement("span");
    kbd.className = "apg-kbd";
    kbd.textContent = "Esc";
    pill.appendChild(kbd);
    pill.appendChild(document.createTextNode(" to cancel"));

    headerText.appendChild(title);
    headerText.appendChild(subtitle);
    headerText.appendChild(pill);

    header.appendChild(icon);
    header.appendChild(headerText);

    const body = document.createElement("div");
    body.className = "apg-body";

    const list = document.createElement("ul");
    list.className = "apg-list";

    const explanation = args.explanation?.length ? args.explanation : ["No details available."];
    for (const line of explanation.slice(0, 6)) {
      const li = document.createElement("li");
      li.textContent = line;
      list.appendChild(li);
    }
    body.appendChild(list);

    const footer = document.createElement("div");
    footer.className = "apg-footer";

    const btnContinue = document.createElement("button");
    btnContinue.className = "apg-btn apg-btn-primary";
    btnContinue.textContent = "Got it";
    btnContinue.addEventListener("click", () => cleanup("continue"));

    // Order: safest actions are more prominent but not confusing
    footer.appendChild(btnContinue);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Focus management
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = getFocusable(modal);
    const initialFocus = btnContinue; // safest default
    initialFocus.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup("continue");
        return;
      }

      // Simple focus trap
      if (e.key === "Tab") {
        const items = getFocusable(modal);
        if (items.length === 0) return;

        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown, true);

    function cleanup(choice: ModalChoice) {
      document.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
      resolve(choice);
    }
  });
}

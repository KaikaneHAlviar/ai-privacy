"use strict";
(() => {
  // extension/detectors/features.ts
  var CREDENTIAL_KEYWORDS = [
    "password",
    "passwd",
    "pwd",
    "secret",
    "token",
    "api key",
    "apikey",
    "private key",
    "ssh",
    "bearer",
    "authorization",
    "oauth"
  ];
  function normalizeForScan(text, maxChars = 1e4) {
    const t = text != null ? text : "";
    const clipped = t.length > maxChars ? t.slice(0, maxChars) : t;
    return clipped.replace(/\r\n/g, "\n");
  }
  function countLines(text) {
    if (!text) return 0;
    return text.split("\n").length;
  }
  function ratioOf(test, text) {
    if (!text) return 0;
    let count = 0;
    for (const ch of text) if (test(ch)) count++;
    return count / text.length;
  }
  function approxEntropy01(text) {
    var _a;
    if (!text) return 0;
    const freq = /* @__PURE__ */ new Map();
    for (const ch of text) freq.set(ch, ((_a = freq.get(ch)) != null ? _a : 0) + 1);
    const uniqueRatio = Math.min(1, freq.size / 60);
    let maxFrac = 0;
    for (const v of freq.values()) maxFrac = Math.max(maxFrac, v / text.length);
    const uniformity = 1 - maxFrac;
    const score = 0.6 * uniqueRatio + 0.4 * uniformity;
    return Math.max(0, Math.min(1, score));
  }
  function containsKeyValue(text) {
    return /\b[A-Za-z_][A-Za-z0-9_]{1,}\s*[:=]\s*["']?[^\s"']{3,}["']?/m.test(text);
  }
  function containsBase64Like(text) {
    return /\b[A-Za-z0-9+/]{40,}={0,2}\b/.test(text);
  }
  function keywordStats(textLower) {
    let hitCount = 0;
    for (const kw of CREDENTIAL_KEYWORDS) {
      if (textLower.includes(kw)) hitCount++;
    }
    const density = Math.min(1, hitCount / 6);
    return { hit: hitCount > 0, density };
  }
  function extractFeatures(rawText) {
    const text = normalizeForScan(rawText);
    const lower = text.toLowerCase();
    const { hit, density } = keywordStats(lower);
    const symbolRatio = ratioOf((c) => /[^\w\s]/.test(c), text);
    const digitRatio = ratioOf((c) => /\d/.test(c), text);
    return {
      length: text.length,
      lineCount: countLines(text),
      containsBackticks: text.includes("```"),
      containsKeyValuePairs: containsKeyValue(text),
      containsCredentialKeywords: hit,
      keywordDensity: density,
      symbolRatio,
      digitRatio,
      base64Like: containsBase64Like(text),
      entropyApprox: approxEntropy01(text)
    };
  }

  // extension/detectors/rules.ts
  var defaultRedact = (s) => {
    if (s.length <= 8) return "****";
    return `${s.slice(0, 3)}\u2026${s.slice(-3)}`;
  };
  var RULES = [
    // --- High-signal secrets / credentials ---
    {
      category: "PRIVATE_KEY",
      label: "Private key material",
      confidence: 0.98,
      regex: /-----BEGIN (RSA|EC|DSA|OPENSSH|PGP)? ?PRIVATE KEY-----/g,
      maxExamples: 1,
      redact: () => "-----BEGIN \u2026 PRIVATE KEY-----"
    },
    {
      category: "JWT",
      label: "JWT token",
      confidence: 0.92,
      regex: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9._-]{10,}\.[a-zA-Z0-9._-]{10,}\b/g,
      maxExamples: 2,
      redact: defaultRedact
    },
    {
      category: "API_KEY",
      label: "API key\u2013like token",
      confidence: 0.9,
      // Common token-ish patterns: sk-*, ghp_*, github_pat_*, xoxb- (Slack), etc.
      regex: /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z\-_]{20,})\b/g,
      maxExamples: 3,
      redact: defaultRedact
    },
    {
      category: "PASSWORD",
      label: "Password/secret assignment",
      confidence: 0.85,
      regex: /\b(password|passwd|pwd|secret|api[_-]?key|token)\b\s*[:=]\s*["']?([^\s"']{6,})["']?/gi,
      maxExamples: 2,
      redact: (s) => {
        const parts = s.split(/[:=]/);
        if (parts.length < 2) return "secret=****";
        return `${parts[0]}=****`;
      }
    },
    {
      category: "ENV_VARS",
      label: ".env / environment variables",
      confidence: 0.75,
      regex: /\b[A-Z][A-Z0-9_]{2,}\s*=\s*["']?[^\s"']{6,}["']?\b/g,
      maxExamples: 3,
      redact: (s) => {
        const idx = s.indexOf("=");
        if (idx === -1) return "ENV_VAR=****";
        return `${s.slice(0, idx)}=****`;
      }
    },
    {
      category: "DB_CONNECTION",
      label: "Database connection string",
      confidence: 0.9,
      regex: /\b(?:postgres(?:ql)?:\/\/|mysql:\/\/|mongodb(?:\+srv)?:\/\/|mssql:\/\/|redis:\/\/)[^\s"'<>]{10,}\b/gi,
      maxExamples: 2,
      redact: defaultRedact
    },
    // --- PII-ish patterns (medium signal) ---
    {
      category: "EMAIL",
      label: "Email address",
      confidence: 0.6,
      regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      maxExamples: 2,
      redact: (s) => {
        const [user, domain] = s.split("@");
        if (!domain) return "***@***";
        const safeUser = user.length <= 2 ? "*" : `${user[0]}\u2026${user.slice(-1)}`;
        return `${safeUser}@${domain}`;
      }
    },
    {
      category: "PHONE",
      label: "Phone number",
      confidence: 0.55,
      regex: /\b(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
      maxExamples: 2,
      redact: () => "***-***-****"
    },
    {
      category: "CREDIT_CARD",
      label: "Credit card\u2013like number",
      confidence: 0.55,
      // Not perfect; we’ll later add Luhn validation if needed.
      regex: /\b(?:\d[ -]*?){13,19}\b/g,
      maxExamples: 1,
      redact: defaultRedact
    },
    {
      category: "IP_ADDRESS",
      label: "IP address",
      confidence: 0.5,
      regex: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
      maxExamples: 2,
      redact: defaultRedact
    },
    // --- Contextual leak-y things (lower confidence) ---
    {
      category: "FILE_PATH",
      label: "Local file path",
      confidence: 0.4,
      regex: /\b(?:[A-Z]:\\Users\\[^\s"'<>]+|\/Users\/[^\s"'<>]+|\/home\/[^\s"'<>]+)\b/g,
      maxExamples: 2,
      redact: (s) => {
        if (s.startsWith("C:\\")) return "C:\\Users\\\u2026";
        if (s.startsWith("/Users/")) return "/Users/\u2026";
        if (s.startsWith("/home/")) return "/home/\u2026";
        return defaultRedact(s);
      }
    },
    {
      category: "CODE_SNIPPET",
      label: "Code snippet",
      confidence: 0.35,
      // Look for triple-backtick blocks OR common syntax patterns
      regex: /```[\s\S]{20,}```|(?:\b(function|class|import|export|const|let|var|def)\b[\s\S]{10,})/g,
      maxExamples: 1,
      redact: () => "Code snippet detected"
    }
  ];
  function collectExamples(text, re, max) {
    const examples = [];
    const regex = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    while ((m = regex.exec(text)) !== null) {
      if (!m[0]) continue;
      examples.push(m[0]);
      if (examples.length >= max) break;
    }
    return examples;
  }
  function runRuleDetectors(text) {
    var _a;
    const hits = [];
    for (const rule of RULES) {
      const regex = new RegExp(rule.regex.source, rule.regex.flags.includes("g") ? rule.regex.flags : rule.regex.flags + "g");
      let matchCount = 0;
      let m;
      while ((m = regex.exec(text)) !== null) {
        matchCount++;
        if (matchCount > 50) break;
      }
      if (matchCount > 0) {
        const maxExamples = (_a = rule.maxExamples) != null ? _a : 0;
        const rawExamples = maxExamples > 0 ? collectExamples(text, rule.regex, maxExamples) : void 0;
        const examples = rawExamples == null ? void 0 : rawExamples.map((ex) => rule.redact ? rule.redact(ex) : defaultRedact(ex));
        hits.push({
          category: rule.category,
          label: rule.label,
          confidence: rule.confidence,
          matchCount,
          examples
        });
      }
    }
    const byCategory = /* @__PURE__ */ new Map();
    for (const hit of hits) {
      const prev = byCategory.get(hit.category);
      if (!prev || hit.confidence > prev.confidence) byCategory.set(hit.category, hit);
    }
    return Array.from(byCategory.values()).sort((a, b) => b.confidence - a.confidence);
  }

  // extension/detectors/classifier.ts
  function clamp01(x) {
    return Math.max(0, Math.min(1, x));
  }
  function maxConfidence(hits, category) {
    const h = hits.find((x) => x.category === category);
    return h ? h.confidence : 0;
  }
  function scanTextForRisk(rawText) {
    const text = normalizeForScan(rawText);
    if (!text || text.trim().length < 4) {
      return { riskLevel: "ALLOW", riskScore: 0, hits: [], explanation: [] };
    }
    const hits = runRuleDetectors(text);
    const f = extractFeatures(text);
    const privateKey = maxConfidence(hits, "PRIVATE_KEY");
    const apiKey = maxConfidence(hits, "API_KEY");
    const jwt = maxConfidence(hits, "JWT");
    const passwordAssign = maxConfidence(hits, "PASSWORD");
    const dbConn = maxConfidence(hits, "DB_CONNECTION");
    const rulesCore = 0.95 * privateKey + 0.8 * apiKey + 0.75 * jwt + 0.65 * passwordAssign + 0.75 * dbConn;
    const longTextBoost = f.length > 500 ? 0.08 : f.length > 150 ? 0.04 : 0;
    const keyValueBoost = f.containsKeyValuePairs ? 0.15 : 0;
    const keywordBoost = f.containsCredentialKeywords ? 0.18 * f.keywordDensity : 0;
    const entropyBoost = 0.18 * f.entropyApprox;
    const base64Boost = f.base64Like ? 0.18 : 0;
    const symbolBoost = f.symbolRatio > 0.25 ? 0.08 : 0;
    const digitBoost = f.digitRatio > 0.22 ? 0.06 : 0;
    const codeHit = maxConfidence(hits, "CODE_SNIPPET");
    const codeBoost = codeHit > 0 ? 0.05 : 0;
    const heuristic = longTextBoost + keyValueBoost + keywordBoost + entropyBoost + base64Boost + symbolBoost + digitBoost + codeBoost;
    const riskScore = clamp01(0.75 * clamp01(rulesCore) + 0.35 * clamp01(heuristic));
    let riskLevel = "ALLOW";
    if (privateKey >= 0.95) riskLevel = "BLOCK";
    else if (riskScore >= 0.6) riskLevel = "WARN";
    else if (riskScore >= 0.35) riskLevel = "WARN";
    const explanation = [];
    for (const hit of hits.slice(0, 4)) {
      if (hit.examples && hit.examples.length > 0) {
        explanation.push(`${hit.label} (${hit.matchCount}) e.g., ${hit.examples.join(", ")}`);
      } else {
        explanation.push(`${hit.label} (${hit.matchCount})`);
      }
    }
    if (explanation.length === 0) {
      if (f.containsCredentialKeywords) explanation.push("Credential-related language detected.");
      if (f.containsKeyValuePairs) explanation.push("Key/value assignment patterns detected.");
      if (f.base64Like) explanation.push("Base64-like encoded block detected.");
      if (f.entropyApprox > 0.7) explanation.push("High-entropy token-like text detected.");
    }
    return { riskLevel, riskScore, hits, explanation };
  }

  // extension/ui/modal.ts
  var OVERLAY_ID = "__ai_privacy_guard_overlay__";
  var STYLE_ID = "__ai_privacy_guard_style__";
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
  function formatPercent01(x) {
    const pct = Math.round(Math.max(0, Math.min(1, x)) * 100);
    return `${pct}%`;
  }
  function iconForLevel(level) {
    if (level === "BLOCK") return "\u26D4";
    return "\u26A0\uFE0F";
  }
  function titleForLevel(level) {
    if (level === "BLOCK") return "Sensitive data likely detected";
    return "Potential sensitive data detected";
  }
  function subtitleForLevel(level) {
    if (level === "BLOCK") {
      return "This looks like high-risk content (e.g., private keys). Consider redacting before sending.";
    }
    return "Review what was detected before sending this to an AI tool.";
  }
  function removeExistingOverlay() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
  }
  function getFocusable(container) {
    const selectors = [
      "button",
      "[href]",
      "input",
      "select",
      "textarea",
      "[tabindex]:not([tabindex='-1'])"
    ];
    return Array.from(container.querySelectorAll(selectors.join(","))).filter(
      (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1
    );
  }
  function showWarningModal(args) {
    ensureStyles();
    removeExistingOverlay();
    return new Promise((resolve) => {
      var _a;
      const overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
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
      pill.textContent = `Risk confidence: ${formatPercent01(args.riskScore)} \u2022 Press `;
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
      const explanation = ((_a = args.explanation) == null ? void 0 : _a.length) ? args.explanation : ["No details available."];
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
      footer.appendChild(btnContinue);
      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      const previouslyFocused = document.activeElement;
      const focusables = getFocusable(modal);
      const initialFocus = btnContinue;
      initialFocus.focus();
      function onKeyDown(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          cleanup("continue");
          return;
        }
        if (e.key === "Tab") {
          const items = getFocusable(modal);
          if (items.length === 0) return;
          const first = items[0];
          const last = items[items.length - 1];
          const active = document.activeElement;
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
      function cleanup(choice) {
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
        if (previouslyFocused && typeof previouslyFocused.focus === "function") {
          previouslyFocused.focus();
        }
        resolve(choice);
      }
    });
  }

  // extension/content/interceptor.ts
  var AI_INPUT_SELECTOR_CANDIDATES = ["textarea", "[contenteditable='true']"];
  var modalOpen = false;
  function safeHost() {
    try {
      return window.location.host || "unknown";
    } catch (e) {
      return "unknown";
    }
  }
  function toCategories(result) {
    return Array.from(new Set(result.hits.map((h) => h.category))).slice(0, 12);
  }
  async function logAnalyticsEvent(args) {
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
          action: args.action
        }
      });
    } catch (e) {
    }
  }
  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function isEditableTarget(el) {
    return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || el.isContentEditable;
  }
  function getTextFromInput(el) {
    var _a, _b;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      return (_a = el.value) != null ? _a : "";
    }
    return (_b = el.innerText) != null ? _b : "";
  }
  function findActiveAIInput() {
    const active = document.activeElement;
    if (active && isEditableTarget(active) && isVisible(active)) {
      return active;
    }
    for (const selector of AI_INPUT_SELECTOR_CANDIDATES) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        if (!isVisible(node)) continue;
        if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) return node;
        if (node.isContentEditable) return node;
      }
    }
    return null;
  }
  async function maybeWarn(text, source) {
    const result = scanTextForRisk(text);
    if (result.riskLevel === "ALLOW") return { action: "allow", result };
    modalOpen = true;
    try {
      const choice = await showWarningModal({
        riskLevel: result.riskLevel,
        riskScore: result.riskScore,
        explanation: result.explanation
      });
      await logAnalyticsEvent({
        source,
        riskLevel: result.riskLevel,
        // WARN | BLOCK
        riskScore: result.riskScore,
        categories: toCategories(result),
        action: choice
      });
      return { action: choice, result };
    } finally {
      modalOpen = false;
    }
  }
  async function handleTextSubmission(el) {
    const text = getTextFromInput(el);
    if (!text || text.trim().length < 4) return true;
    const { action } = await maybeWarn(text, "send");
    return action === "allow" || action === "continue";
  }
  document.addEventListener(
    "paste",
    async (e) => {
      var _a;
      if (modalOpen) return;
      const target = e.target;
      if (!target || !isEditableTarget(target)) return;
      const pastedText = (_a = e.clipboardData) == null ? void 0 : _a.getData("text");
      if (!pastedText) return;
      await maybeWarn(pastedText, "paste");
    },
    true
    // capture: we want to run before site handlers
  );
  document.addEventListener(
    "keydown",
    async (e) => {
      if (modalOpen) return;
      if (e.key !== "Enter") return;
      if (e.shiftKey) return;
      if (e.isComposing) return;
      const active = findActiveAIInput();
      if (!active) return;
      const focused = document.activeElement;
      if (focused && focused !== active && !active.contains(focused)) return;
      await handleTextSubmission(active);
    },
    true
    // capture so we can prevent before app handlers send
  );
})();
//# sourceMappingURL=interceptor.js.map

// extension/detectors/rules.ts
const defaultRedact = (s) => {
    if (s.length <= 8)
        return "****";
    return `${s.slice(0, 3)}…${s.slice(-3)}`;
};
const RULES = [
    // --- High-signal secrets / credentials ---
    {
        category: "PRIVATE_KEY",
        label: "Private key material",
        confidence: 0.98,
        regex: /-----BEGIN (RSA|EC|DSA|OPENSSH|PGP)? ?PRIVATE KEY-----/g,
        maxExamples: 1,
        redact: () => "-----BEGIN … PRIVATE KEY-----",
    },
    {
        category: "JWT",
        label: "JWT token",
        confidence: 0.92,
        regex: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9._-]{10,}\.[a-zA-Z0-9._-]{10,}\b/g,
        maxExamples: 2,
        redact: defaultRedact,
    },
    {
        category: "API_KEY",
        label: "API key–like token",
        confidence: 0.9,
        // Common token-ish patterns: sk-*, ghp_*, github_pat_*, xoxb- (Slack), etc.
        regex: /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z\-_]{20,})\b/g,
        maxExamples: 3,
        redact: defaultRedact,
    },
    {
        category: "PASSWORD",
        label: "Password/secret assignment",
        confidence: 0.85,
        regex: /\b(password|passwd|pwd|secret|api[_-]?key|token)\b\s*[:=]\s*["']?([^\s"']{6,})["']?/gi,
        maxExamples: 2,
        redact: (s) => {
            // Redact RHS if possible
            const parts = s.split(/[:=]/);
            if (parts.length < 2)
                return "secret=****";
            return `${parts[0]}=****`;
        },
    },
    {
        category: "ENV_VARS",
        label: ".env / environment variables",
        confidence: 0.75,
        regex: /\b[A-Z][A-Z0-9_]{2,}\s*=\s*["']?[^\s"']{6,}["']?\b/g,
        maxExamples: 3,
        redact: (s) => {
            const idx = s.indexOf("=");
            if (idx === -1)
                return "ENV_VAR=****";
            return `${s.slice(0, idx)}=****`;
        },
    },
    {
        category: "DB_CONNECTION",
        label: "Database connection string",
        confidence: 0.9,
        regex: /\b(?:postgres(?:ql)?:\/\/|mysql:\/\/|mongodb(?:\+srv)?:\/\/|mssql:\/\/|redis:\/\/)[^\s"'<>]{10,}\b/gi,
        maxExamples: 2,
        redact: defaultRedact,
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
            if (!domain)
                return "***@***";
            const safeUser = user.length <= 2 ? "*" : `${user[0]}…${user.slice(-1)}`;
            return `${safeUser}@${domain}`;
        },
    },
    {
        category: "PHONE",
        label: "Phone number",
        confidence: 0.55,
        regex: /\b(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
        maxExamples: 2,
        redact: () => "***-***-****",
    },
    {
        category: "CREDIT_CARD",
        label: "Credit card–like number",
        confidence: 0.55,
        // Not perfect; we’ll later add Luhn validation if needed.
        regex: /\b(?:\d[ -]*?){13,19}\b/g,
        maxExamples: 1,
        redact: defaultRedact,
    },
    {
        category: "IP_ADDRESS",
        label: "IP address",
        confidence: 0.5,
        regex: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
        maxExamples: 2,
        redact: defaultRedact,
    },
    // --- Contextual leak-y things (lower confidence) ---
    {
        category: "FILE_PATH",
        label: "Local file path",
        confidence: 0.4,
        regex: /\b(?:[A-Z]:\\Users\\[^\s"'<>]+|\/Users\/[^\s"'<>]+|\/home\/[^\s"'<>]+)\b/g,
        maxExamples: 2,
        redact: (s) => {
            // Keep top-level root, redact rest
            if (s.startsWith("C:\\"))
                return "C:\\Users\\…";
            if (s.startsWith("/Users/"))
                return "/Users/…";
            if (s.startsWith("/home/"))
                return "/home/…";
            return defaultRedact(s);
        },
    },
    {
        category: "CODE_SNIPPET",
        label: "Code snippet",
        confidence: 0.35,
        // Look for triple-backtick blocks OR common syntax patterns
        regex: /```[\s\S]{20,}```|(?:\b(function|class|import|export|const|let|var|def)\b[\s\S]{10,})/g,
        maxExamples: 1,
        redact: () => "Code snippet detected",
    },
];
function collectExamples(text, re, max) {
    const examples = [];
    // Ensure global for iterative matching
    const regex = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    while ((m = regex.exec(text)) !== null) {
        if (!m[0])
            continue;
        examples.push(m[0]);
        if (examples.length >= max)
            break;
    }
    return examples;
}
export function runRuleDetectors(text) {
    var _a;
    const hits = [];
    for (const rule of RULES) {
        const regex = new RegExp(rule.regex.source, rule.regex.flags.includes("g") ? rule.regex.flags : rule.regex.flags + "g");
        let matchCount = 0;
        // Count matches quickly
        let m;
        while ((m = regex.exec(text)) !== null) {
            matchCount++;
            if (matchCount > 50)
                break; // hard stop for perf
        }
        if (matchCount > 0) {
            const maxExamples = (_a = rule.maxExamples) !== null && _a !== void 0 ? _a : 0;
            const rawExamples = maxExamples > 0 ? collectExamples(text, rule.regex, maxExamples) : undefined;
            const examples = rawExamples === null || rawExamples === void 0 ? void 0 : rawExamples.map((ex) => (rule.redact ? rule.redact(ex) : defaultRedact(ex)));
            hits.push({
                category: rule.category,
                label: rule.label,
                confidence: rule.confidence,
                matchCount,
                examples,
            });
        }
    }
    // De-dupe by category keeping highest-confidence entry
    const byCategory = new Map();
    for (const hit of hits) {
        const prev = byCategory.get(hit.category);
        if (!prev || hit.confidence > prev.confidence)
            byCategory.set(hit.category, hit);
    }
    return Array.from(byCategory.values()).sort((a, b) => b.confidence - a.confidence);
}

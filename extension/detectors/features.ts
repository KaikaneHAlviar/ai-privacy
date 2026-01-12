export interface Features {
  length: number;
  lineCount: number;
  containsBackticks: boolean;
  containsKeyValuePairs: boolean;
  containsCredentialKeywords: boolean;
  keywordDensity: number; // 0..1
  symbolRatio: number; // 0..1
  digitRatio: number; // 0..1
  base64Like: boolean;
  entropyApprox: number; // 0..1
}

const CREDENTIAL_KEYWORDS = [
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
  "oauth",
];

export function normalizeForScan(text: string, maxChars = 10000): string {
  const t = text ?? "";
  // limit length for perf; scanning beyond this gives diminishing returns
  const clipped = t.length > maxChars ? t.slice(0, maxChars) : t;
  // normalize newlines and whitespace (but preserve enough structure)
  return clipped.replace(/\r\n/g, "\n");
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function ratioOf(test: (c: string) => boolean, text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const ch of text) if (test(ch)) count++;
  return count / text.length;
}

function approxEntropy01(text: string): number {
  // Cheap approximation: more unique chars and more uniform distribution => higher "entropy-ish" score
  // Not Shannon entropy; good enough for heuristic signal in v1.
  if (!text) return 0;
  const freq = new Map<string, number>();
  for (const ch of text) freq.set(ch, (freq.get(ch) ?? 0) + 1);

  const uniqueRatio = Math.min(1, freq.size / 60); // 60 chosen as rough saturation
  // penalize if one char dominates
  let maxFrac = 0;
  for (const v of freq.values()) maxFrac = Math.max(maxFrac, v / text.length);
  const uniformity = 1 - maxFrac; // higher is better
  const score = 0.6 * uniqueRatio + 0.4 * uniformity;
  return Math.max(0, Math.min(1, score));
}

function containsKeyValue(text: string): boolean {
  // Look for patterns like KEY=VALUE or key: value across multiple lines
  return /\b[A-Za-z_][A-Za-z0-9_]{1,}\s*[:=]\s*["']?[^\s"']{3,}["']?/m.test(text);
}

function containsBase64Like(text: string): boolean {
  // long-ish base64-like chunks
  return /\b[A-Za-z0-9+/]{40,}={0,2}\b/.test(text);
}

function keywordStats(textLower: string) {
  let hitCount = 0;
  for (const kw of CREDENTIAL_KEYWORDS) {
    if (textLower.includes(kw)) hitCount++;
  }
  const density = Math.min(1, hitCount / 6); // cap
  return { hit: hitCount > 0, density };
}

export function extractFeatures(rawText: string): Features {
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
    entropyApprox: approxEntropy01(text),
  };
}

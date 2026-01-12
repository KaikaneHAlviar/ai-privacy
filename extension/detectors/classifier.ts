import { extractFeatures, normalizeForScan } from "./features";
import { runRuleDetectors, RuleHit, RiskCategory } from "./rules";

export type RiskLevel = "ALLOW" | "WARN" | "BLOCK";

export interface ScanResult {
  riskLevel: RiskLevel;
  riskScore: number; // 0..1
  hits: RuleHit[]; // explainable categories
  explanation: string[]; // bullet-style reasons
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function maxConfidence(hits: RuleHit[], category: RiskCategory): number {
  const h = hits.find((x) => x.category === category);
  return h ? h.confidence : 0;
}

export function scanTextForRisk(rawText: string): ScanResult {
  const text = normalizeForScan(rawText);

  // Empty or tiny strings are safe
  if (!text || text.trim().length < 4) {
    return { riskLevel: "ALLOW", riskScore: 0, hits: [], explanation: [] };
  }

  const hits = runRuleDetectors(text);
  const f = extractFeatures(text);

  // --- Rule-based base score (high precision signals) ---
  const privateKey = maxConfidence(hits, "PRIVATE_KEY");
  const apiKey = maxConfidence(hits, "API_KEY");
  const jwt = maxConfidence(hits, "JWT");
  const passwordAssign = maxConfidence(hits, "PASSWORD");
  const dbConn = maxConfidence(hits, "DB_CONNECTION");

  // Weighted max-ish aggregation
  const rulesCore =
    0.95 * privateKey +
    0.8 * apiKey +
    0.75 * jwt +
    0.65 * passwordAssign +
    0.75 * dbConn;

  // --- Heuristic features (ML-inspired) ---
  // These capture “looks like secrets/code/data” even without matching a specific token pattern.
  const longTextBoost = f.length > 500 ? 0.08 : f.length > 150 ? 0.04 : 0;
  const keyValueBoost = f.containsKeyValuePairs ? 0.15 : 0;
  const keywordBoost = f.containsCredentialKeywords ? 0.18 * f.keywordDensity : 0;
  const entropyBoost = 0.18 * f.entropyApprox;
  const base64Boost = f.base64Like ? 0.18 : 0;
  const symbolBoost = f.symbolRatio > 0.25 ? 0.08 : 0;
  const digitBoost = f.digitRatio > 0.22 ? 0.06 : 0;

  // Code snippets are not always “sensitive”, but often indicate copying internal code.
  const codeHit = maxConfidence(hits, "CODE_SNIPPET");
  const codeBoost = codeHit > 0 ? 0.05 : 0;

  const heuristic =
    longTextBoost +
    keyValueBoost +
    keywordBoost +
    entropyBoost +
    base64Boost +
    symbolBoost +
    digitBoost +
    codeBoost;

  // Combine: rules dominate, heuristics support
  const riskScore = clamp01(0.75 * clamp01(rulesCore) + 0.35 * clamp01(heuristic));

  // Determine risk level thresholds
  // - BLOCK is reserved for extremely strong indicators (e.g., private keys)
  let riskLevel: RiskLevel = "ALLOW";
  if (privateKey >= 0.95) riskLevel = "BLOCK";
  else if (riskScore >= 0.6) riskLevel = "WARN";
  else if (riskScore >= 0.35) riskLevel = "WARN";

  // Explanation strings (human-readable)
  const explanation: string[] = [];
  for (const hit of hits.slice(0, 4)) {
    if (hit.examples && hit.examples.length > 0) {
      explanation.push(`${hit.label} (${hit.matchCount}) e.g., ${hit.examples.join(", ")}`);
    } else {
      explanation.push(`${hit.label} (${hit.matchCount})`);
    }
  }

  if (explanation.length === 0) {
    // Provide feature-based rationale if no direct hits
    if (f.containsCredentialKeywords) explanation.push("Credential-related language detected.");
    if (f.containsKeyValuePairs) explanation.push("Key/value assignment patterns detected.");
    if (f.base64Like) explanation.push("Base64-like encoded block detected.");
    if (f.entropyApprox > 0.7) explanation.push("High-entropy token-like text detected.");
  }

  return { riskLevel, riskScore, hits, explanation };
}

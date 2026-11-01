// Deterministic commercial scoring. No AI, no randomness, integer arithmetic
// for the weighted total so identical inputs always give identical results.

export const CRITERIA = [
  { key: "earnings", label: "Earning potential and profit economics", help: "Gross profit, repeatability, contribution margin, owner earnings, addressable buyers." },
  { key: "demand", label: "Verified demand and willingness to pay", help: "Pain frequency, urgency and payment signals. Competitor sales alone are not proof of demand for this offer." },
  { key: "acquisition", label: "Customer acquisition and speed to revenue", help: "Reachable buyer, channel, sales cycle, likely cost of first paying customer." },
  { key: "ai_leverage", label: "AI leverage and scalability", help: "Repeatable delivery and automation. Do not assume AI alone is defensible." },
  { key: "operational_burden", label: "Operational burden and customer interaction", help: "Higher score = lower burden. Estimate ongoing hours per 10 customers." },
  { key: "capital_risk", label: "Capital requirements and execution risk", help: "Higher score = lower risk. Build cost, compliance, data/privacy, platform risk." },
] as const;
export type CriterionKey = (typeof CRITERIA)[number]["key"];

export const GATES = [
  { key: "willingness_to_pay", label: "Credible evidence of willingness to pay" },
  { key: "unit_economics", label: "Viable unit economics" },
  { key: "acquisition", label: "Plausible customer acquisition" },
  { key: "delivery", label: "Technically achievable delivery" },
  { key: "legal", label: "Manageable legal and regulatory risk" },
] as const;
export type GateKey = (typeof GATES)[number]["key"];

export const EVIDENCE_LEVELS = [
  { key: "verified", label: "Verified evidence", weight: 1.0 },
  { key: "credible_secondary", label: "Credible secondary evidence", weight: 0.75 },
  { key: "inference", label: "Inference", weight: 0.4 },
  { key: "estimate", label: "Estimate", weight: 0.3 },
  { key: "unsupported", label: "Unsupported assumption", weight: 0 },
] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number]["key"];
const EVIDENCE_WEIGHT: Record<EvidenceLevel, number> = Object.fromEntries(
  EVIDENCE_LEVELS.map((e) => [e.key, e.weight]),
) as Record<EvidenceLevel, number>;

/** Evidence levels strong enough to satisfy a gate or support a PASS. */
export const STRONG_EVIDENCE: EvidenceLevel[] = ["verified", "credible_secondary"];

export type CriterionScore = {
  key: CriterionKey;
  score: number | null; // 0–10, one decimal place
  evidence: EvidenceLevel;
  rationale?: string;
};
export type GateStatus = "satisfied" | "unknown" | "blocker";
export type GateAssessment = { key: GateKey; status: GateStatus; evidence: EvidenceLevel; note?: string };

export type Weights = Record<CriterionKey, number>; // whole percentages summing to 100
export type Thresholds = { pass: number; investigate: number; minEvidenceConfidence: number };
export type Decision = "PASS" | "INVESTIGATE" | "FAIL" | "UNSCORED";

export type ScoreResult = {
  weightedTotal: number | null; // 0–100, two decimals
  evidenceConfidence: number; // 0–1, weighted by criterion weight
  evidenceLabel: "High" | "Medium" | "Low";
  decision: Decision;
  reasons: string[];
  contributions: { key: CriterionKey; label: string; score: number | null; weight: number; points: number | null }[];
};

export const DEFAULT_WEIGHTS: Weights = {
  earnings: 35, demand: 20, acquisition: 15, ai_leverage: 15, operational_burden: 10, capital_risk: 5,
};
export const DEFAULT_THRESHOLDS: Thresholds = { pass: 80, investigate: 60, minEvidenceConfidence: 0.65 };

export function validateWeights(w: Record<string, unknown>): string[] {
  const errors: string[] = [];
  let sum = 0;
  for (const c of CRITERIA) {
    const v = w[c.key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100) {
      errors.push(`${c.label}: weight must be a whole number from 0 to 100`);
    } else sum += v;
  }
  if (errors.length === 0 && sum !== 100) errors.push(`Weights must total 100% (currently ${sum}%)`);
  return errors;
}

/** Score to tenths as an integer (7.25 → 73). Rejects out-of-range values. */
function tenths(score: number): number {
  if (!Number.isFinite(score) || score < 0 || score > 10) throw new Error(`Score ${score} must be between 0 and 10`);
  return Math.round(score * 10);
}

export function scoreOpportunity(
  criteria: CriterionScore[],
  gates: GateAssessment[],
  weights: Weights = DEFAULT_WEIGHTS,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): ScoreResult {
  const wErr = validateWeights(weights);
  if (wErr.length) throw new Error(wErr.join("; "));
  const byKey = new Map(criteria.map((c) => [c.key, c]));
  const reasons: string[] = [];

  // Weighted total: Σ(score_tenths × weight%) is an exact integer = total × 100.
  let sumIntegers = 0;
  let evidenceNumerator = 0;
  let missing = 0;
  const contributions = CRITERIA.map((c) => {
    const cs = byKey.get(c.key);
    const weight = weights[c.key];
    if (!cs || cs.score === null || cs.score === undefined) {
      missing++;
      return { key: c.key, label: c.label, score: null, weight, points: null };
    }
    const t = tenths(cs.score);
    sumIntegers += t * weight;
    evidenceNumerator += EVIDENCE_WEIGHT[cs.evidence ?? "unsupported"] * weight;
    return { key: c.key, label: c.label, score: t / 10, weight, points: (t * weight) / 100 };
  });

  const evidenceConfidence = Math.round((evidenceNumerator / 100) * 1000) / 1000;
  const evidenceLabel = evidenceConfidence >= 0.75 ? "High" : evidenceConfidence >= 0.45 ? "Medium" : "Low";

  if (missing > 0) {
    return {
      weightedTotal: null, evidenceConfidence, evidenceLabel, decision: "UNSCORED",
      reasons: [`${missing} of ${CRITERIA.length} criteria have no score yet, so no decision is made.`],
      contributions,
    };
  }
  const weightedTotal = sumIntegers / 100;

  // 1. Critical blockers override any score.
  const gateMap = new Map(gates.map((g) => [g.key, g]));
  const blockers = GATES.filter((g) => gateMap.get(g.key)?.status === "blocker");
  if (blockers.length) {
    for (const b of blockers) reasons.push(`Critical blocker: ${b.label}${gateMap.get(b.key)?.note ? ` — ${gateMap.get(b.key)!.note}` : ""}.`);
    return { weightedTotal, evidenceConfidence, evidenceLabel, decision: "FAIL", reasons, contributions };
  }

  // 2. Score below the investigate threshold fails.
  if (weightedTotal < thresholds.investigate) {
    reasons.push(`Weighted score ${weightedTotal.toFixed(2)} is below the ${thresholds.investigate} threshold.`);
    return { weightedTotal, evidenceConfidence, evidenceLabel, decision: "FAIL", reasons, contributions };
  }

  // 3. PASS needs score, evidence confidence, strong demand evidence and every gate evidenced.
  if (weightedTotal >= thresholds.pass) {
    const pr: string[] = [];
    if (evidenceConfidence < thresholds.minEvidenceConfidence) {
      pr.push(`Evidence confidence ${(evidenceConfidence * 100).toFixed(0)}% is below the ${(thresholds.minEvidenceConfidence * 100).toFixed(0)}% needed for PASS.`);
    }
    const demand = byKey.get("demand");
    if (!demand || !STRONG_EVIDENCE.includes(demand.evidence)) {
      pr.push("Demand score is not backed by verified or credible secondary evidence.");
    }
    for (const g of GATES) {
      const a = gateMap.get(g.key);
      if (!a || a.status !== "satisfied") pr.push(`Gate not yet satisfied: ${g.label}.`);
      else if (!STRONG_EVIDENCE.includes(a.evidence)) pr.push(`Gate "${g.label}" is marked satisfied but only on ${a.evidence} evidence.`);
    }
    if (pr.length === 0) {
      reasons.push(`Weighted score ${weightedTotal.toFixed(2)} ≥ ${thresholds.pass}, evidence confidence ${(evidenceConfidence * 100).toFixed(0)}%, all critical gates evidenced.`);
      reasons.push("PASS means proceed to a tightly scoped commercial test, not permission to scale.");
      return { weightedTotal, evidenceConfidence, evidenceLabel, decision: "PASS", reasons, contributions };
    }
    reasons.push(`Score ${weightedTotal.toFixed(2)} meets the PASS threshold, but PASS is withheld:`);
    reasons.push(...pr);
    return { weightedTotal, evidenceConfidence, evidenceLabel, decision: "INVESTIGATE", reasons, contributions };
  }

  reasons.push(`Weighted score ${weightedTotal.toFixed(2)} is in the INVESTIGATE band (${thresholds.investigate}–${thresholds.pass - 0.01}).`);
  const unknownGates = GATES.filter((g) => gateMap.get(g.key)?.status !== "satisfied");
  if (unknownGates.length) reasons.push(`${unknownGates.length} critical gate(s) still unresolved.`);
  return { weightedTotal, evidenceConfidence, evidenceLabel, decision: "INVESTIGATE", reasons, contributions };
}

export function emptyCriteria(): CriterionScore[] {
  return CRITERIA.map((c) => ({ key: c.key, score: null, evidence: "unsupported" as EvidenceLevel, rationale: "" }));
}
export function emptyGates(): GateAssessment[] {
  return GATES.map((g) => ({ key: g.key, status: "unknown" as GateStatus, evidence: "unsupported" as EvidenceLevel, note: "" }));
}

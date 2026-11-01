import { describe, expect, it } from "vitest";
import {
  CRITERIA, GATES, scoreOpportunity, validateWeights, DEFAULT_WEIGHTS,
  type CriterionScore, type GateAssessment, type EvidenceLevel,
} from "@/lib/scoring";

const crit = (scores: number[], evidence: EvidenceLevel = "verified"): CriterionScore[] =>
  CRITERIA.map((c, i) => ({ key: c.key, score: scores[i], evidence }));
const gates = (status: GateAssessment["status"] = "satisfied", evidence: EvidenceLevel = "verified"): GateAssessment[] =>
  GATES.map((g) => ({ key: g.key, status, evidence }));

describe("weighted score (acceptance test 3)", () => {
  it("matches the hand calculation", () => {
    // 9×35 + 8×20 + 7×15 + 8×15 + 6×10 + 5×5 = 315+160+105+120+60+25 = 785 → 78.5
    expect(scoreOpportunity(crit([9, 8, 7, 8, 6, 5]), gates()).weightedTotal).toBe(78.5);
  });
  it("matches the workbook formula ROUND((C*35+D*20+E*15+F*15+G*10+H*5)/10,1)", () => {
    const s = [7.3, 6.1, 8.8, 4.4, 9.9, 0.7];
    const excel = Math.round(((s[0] * 35 + s[1] * 20 + s[2] * 15 + s[3] * 15 + s[4] * 10 + s[5] * 5) / 10) * 10) / 10;
    const r = scoreOpportunity(crit(s), gates());
    expect(Math.round(r.weightedTotal! * 10) / 10).toBe(excel);
  });
  it("is identical across 1,000 repeated runs", () => {
    const first = scoreOpportunity(crit([7.3, 6.1, 8.8, 4.4, 9.9, 0.7]), gates());
    for (let n = 0; n < 1000; n++) {
      expect(scoreOpportunity(crit([7.3, 6.1, 8.8, 4.4, 9.9, 0.7]), gates())).toEqual(first);
    }
  });
  it("gives 100 for all tens and 0 for all zeros", () => {
    expect(scoreOpportunity(crit([10, 10, 10, 10, 10, 10]), gates()).weightedTotal).toBe(100);
    expect(scoreOpportunity(crit([0, 0, 0, 0, 0, 0]), gates()).weightedTotal).toBe(0);
  });
  it("rejects out-of-range scores", () => {
    expect(() => scoreOpportunity(crit([11, 5, 5, 5, 5, 5]), gates())).toThrow();
    expect(() => scoreOpportunity(crit([-1, 5, 5, 5, 5, 5]), gates())).toThrow();
  });
  it("returns UNSCORED when any criterion is missing", () => {
    const c = crit([9, 9, 9, 9, 9, 9]);
    c[2].score = null;
    expect(scoreOpportunity(c, gates()).decision).toBe("UNSCORED");
  });
});

describe("decision rules", () => {
  it("PASS when score ≥ 80, evidence strong, all gates evidenced", () => {
    const r = scoreOpportunity(crit([9, 9, 8, 8, 8, 8]), gates());
    expect(r.weightedTotal).toBe(85.5);
    expect(r.decision).toBe("PASS");
  });
  it("insufficient evidence prevents PASS (acceptance test 4)", () => {
    const r = scoreOpportunity(crit([9, 9, 8, 8, 8, 8], "estimate"), gates("satisfied", "estimate"));
    expect(r.weightedTotal).toBe(85.5);
    expect(r.decision).toBe("INVESTIGATE");
    expect(r.reasons.join(" ")).toMatch(/PASS is withheld/);
  });
  it("AI-style optimism (all 10s, inference evidence) cannot PASS", () => {
    const r = scoreOpportunity(crit([10, 10, 10, 10, 10, 10], "inference"), gates("satisfied", "inference"));
    expect(r.decision).toBe("INVESTIGATE");
  });
  it("unverified demand blocks PASS even when other evidence is strong", () => {
    const c = crit([9, 9, 8, 8, 8, 8]);
    c[1].evidence = "inference";
    expect(scoreOpportunity(c, gates()).decision).toBe("INVESTIGATE");
  });
  it("an unresolved gate blocks PASS", () => {
    const g = gates();
    g[0].status = "unknown";
    expect(scoreOpportunity(crit([9, 9, 8, 8, 8, 8]), g).decision).toBe("INVESTIGATE");
  });
  it("a critical blocker produces FAIL regardless of score (acceptance test 5)", () => {
    const g = gates();
    g[4] = { key: "legal", status: "blocker", evidence: "verified", note: "Requires licence we cannot obtain" };
    const r = scoreOpportunity(crit([10, 10, 10, 10, 10, 10]), g);
    expect(r.weightedTotal).toBe(100);
    expect(r.decision).toBe("FAIL");
    expect(r.reasons[0]).toMatch(/Critical blocker: Manageable legal/);
  });
  it("FAIL below 60", () => {
    const r = scoreOpportunity(crit([5, 5, 5, 6, 6, 6]), gates());
    expect(r.weightedTotal).toBe(53);
    expect(r.decision).toBe("FAIL");
  });
  it("boundary: exactly 60 is INVESTIGATE, 59.95 is FAIL", () => {
    expect(scoreOpportunity(crit([6, 6, 6, 6, 6, 6]), gates()).decision).toBe("INVESTIGATE");
    // 6×35+6×20+6×15+6×15+6×10+5.9×5 = 600 - 0.5 → 59.95
    expect(scoreOpportunity(crit([6, 6, 6, 6, 6, 5.9]), gates()).weightedTotal).toBe(59.95);
    expect(scoreOpportunity(crit([6, 6, 6, 6, 6, 5.9]), gates()).decision).toBe("FAIL");
  });
  it("evidence confidence is separate from commercial score", () => {
    const strong = scoreOpportunity(crit([7, 7, 7, 7, 7, 7], "verified"), gates());
    const weak = scoreOpportunity(crit([7, 7, 7, 7, 7, 7], "unsupported"), gates());
    expect(strong.weightedTotal).toBe(weak.weightedTotal);
    expect(strong.evidenceConfidence).toBe(1);
    expect(weak.evidenceConfidence).toBe(0);
  });
});

describe("weights", () => {
  it("default weights are valid", () => expect(validateWeights(DEFAULT_WEIGHTS)).toEqual([]));
  it("rejects weights not totalling 100", () => {
    expect(validateWeights({ ...DEFAULT_WEIGHTS, earnings: 40 })[0]).toMatch(/total 100/);
  });
  it("custom weights change the result deterministically", () => {
    const w = { earnings: 50, demand: 10, acquisition: 10, ai_leverage: 10, operational_burden: 10, capital_risk: 10 };
    // 9×50 + 8×10 + 7×10 + 8×10 + 6×10 + 5×10 = 450+80+70+80+60+50 = 790 → 79
    expect(scoreOpportunity(crit([9, 8, 7, 8, 6, 5]), gates(), w).weightedTotal).toBe(79);
  });
});

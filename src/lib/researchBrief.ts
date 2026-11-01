// Reads an AVI research brief written in Markdown (the format produced by the owner's
// outside research agent) and extracts what AVI can store: the scored wedge, any
// "as framed" score for the parent, a proposed child opportunity, and evidence rows.
// Pure functions — no database access — so they are easy to test.
import type { CriterionKey, CriterionScore, EvidenceLevel, GateAssessment } from "./scoring";
import { CRITERIA, GATES } from "./scoring";

export type BriefEvidence = {
  code: string; claim: string; type: string | null; grain: string | null; sourceText: string | null;
  sourceUrl: string | null; dateText: string | null; confidence: string | null; verifiedFlag: string | null;
  classification: EvidenceLevel;
};

export type ParsedBrief = {
  opportunityCode: string;
  title: string;
  version: string | null;
  preparedOn: string | null;
  scoredVariant: string | null;
  wedgeScores: Partial<Record<CriterionKey, number>>;
  wedgeRationales: Partial<Record<CriterionKey, string>>;
  statedWeightedTotal: number | null;
  asFramedScores: Partial<Record<CriterionKey, number>> | null;
  evidenceConfidence: "Verified" | "Partial" | "Unverified" | null;
  criticalBlockers: string | null;
  classificationNote: string | null;
  childProposal: { code: string; name: string } | null;
  wedgeSentence: string | null;
  nextAction: string | null;
  evidence: BriefEvidence[];
  warnings: string[];
};

const clean = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();

function sections(md: string): { num: number; title: string; body: string }[] {
  const out: { num: number; title: string; body: string }[] = [];
  const re = /^##\s+(\d+)\.\s+(.+)$/gm;
  const hits = [...md.matchAll(re)];
  hits.forEach((h, i) => {
    const start = h.index! + h[0].length;
    const nextIdx = hits[i + 1]?.index ?? md.search(/^##\s+(?!\d)/m) > start ? (hits[i + 1]?.index ?? md.length) : md.length;
    out.push({ num: Number(h[1]), title: h[2].trim(), body: md.slice(start, nextIdx) });
  });
  return out;
}

/** Parses the first Markdown table in `body` into header + row cell arrays. */
function table(body: string, headerTest: (h: string[]) => boolean): { header: string[]; rows: string[][] } | null {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith("|") || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue;
    const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    const header = cells(lines[i]).map((c) => clean(c).toLowerCase());
    if (!headerTest(header)) continue;
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith("|"); j++) rows.push(cells(lines[j]));
    return { header, rows };
  }
  return null;
}

export function criterionFromLabel(label: string): CriterionKey | null {
  const l = label.toLowerCase();
  if (/earning|profit/.test(l)) return "earnings";
  if (/demand|willingness|wtp/.test(l)) return "demand";
  if (/acquisition|speed/.test(l)) return "acquisition";
  if (/\bai\b|leverage|scalab/.test(l)) return "ai_leverage";
  if (/burden|operating|interaction/.test(l)) return "operational_burden";
  if (/capital|execution|risk/.test(l)) return "capital_risk";
  return null;
}

/** The brief's own labels: Y = it says it opened the page; Partial = search summary. AI-reported, so never "verified" here. */
function evidenceLevel(flag: string | null): EvidenceLevel {
  const f = (flag ?? "").trim().toLowerCase();
  if (f.startsWith("y")) return "credible_secondary";
  if (f.startsWith("partial")) return "inference";
  return "unsupported";
}

function firstUrl(text: string | null): string | null {
  if (!text) return null;
  const tok = clean(text).split(/[;\s,]+/).find((t) => /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t));
  if (!tok) return null;
  const url = /^https?:\/\//i.test(tok) ? tok : `https://${tok}`;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseBrief(md: string): ParsedBrief {
  const warnings: string[] = [];
  const titleLine = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
  const head = titleLine.match(/^(AVI-\d+)\s+Research Brief\s+(v[\d.]+)?\s*:?\s*(.*)$/i);
  if (!head) throw new Error("This doesn't look like an AVI research brief. The first heading should start with \"AVI-0xx Research Brief\".");
  const opportunityCode = head[1].toUpperCase();
  const preparedOn = md.match(/\*\*Prepared:\*\*\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;

  const secs = sections(md);
  const find = (re: RegExp) => secs.find((s) => re.test(s.title));

  // Scores
  const scoreSec = find(/AVI score|score/i);
  const wedgeScores: ParsedBrief["wedgeScores"] = {};
  const wedgeRationales: ParsedBrief["wedgeRationales"] = {};
  let statedWeightedTotal: number | null = null;
  let scoredVariant: string | null = null;
  let asFramedScores: ParsedBrief["asFramedScores"] = null;
  let evidenceConfidence: ParsedBrief["evidenceConfidence"] = null;
  let criticalBlockers: string | null = null;
  let classificationNote: string | null = null;
  if (scoreSec) {
    scoredVariant = clean(scoreSec.body.match(/Scored variant:\s*([^\n]+)/i)?.[1] ?? "") || null;
    const t = table(scoreSec.body, (h) => h.some((x) => x.includes("criterion")));
    for (const row of t?.rows ?? []) {
      const label = clean(row[0] ?? "");
      const val = clean(row[1] ?? "");
      if (/weighted/i.test(label)) {
        statedWeightedTotal = Number(val.match(/[\d.]+/)?.[0] ?? NaN);
        if (!Number.isFinite(statedWeightedTotal)) statedWeightedTotal = null;
        continue;
      }
      const key = criterionFromLabel(label);
      const n = Number(val);
      if (key && Number.isFinite(n) && n >= 0 && n <= 10) {
        wedgeScores[key] = n;
        wedgeRationales[key] = clean(row[2] ?? "");
      }
    }
    const framed = scoreSec.body.match(/as framed[^:\n]*:\**\s*Profit\s*([\d.]+),\s*Demand\s*([\d.]+),\s*Acquisition\s*([\d.]+),\s*AI\s*([\d.]+),\s*Burden\s*([\d.]+),\s*Capital\s*([\d.]+)/i);
    if (framed) {
      const keys: CriterionKey[] = ["earnings", "demand", "acquisition", "ai_leverage", "operational_burden", "capital_risk"];
      asFramedScores = Object.fromEntries(keys.map((k, i) => [k, Number(framed[i + 1])]));
    }
    const conf = scoreSec.body.match(/Evidence confidence:\**\s*\**\s*(Verified|Partial|Unverified)/i)?.[1];
    evidenceConfidence = conf ? ((conf[0].toUpperCase() + conf.slice(1).toLowerCase()) as ParsedBrief["evidenceConfidence"]) : null;
    criticalBlockers = clean(scoreSec.body.match(/Critical blockers:\**\s*([^\n]+)/i)?.[1] ?? "") || null;
    classificationNote = clean(scoreSec.body.match(/Classification:\**\s*([^\n]+)/i)?.[1] ?? "") || null;
  } else warnings.push("No score section found.");
  const missing = CRITERIA.filter((c) => wedgeScores[c.key] === undefined);
  if (scoreSec && missing.length) warnings.push(`Score table is missing: ${missing.map((m) => m.label).join(", ")}.`);

  // Proposed child opportunity ("mint AVI-032 "Name"")
  const recSec = find(/recommendation/i);
  const child = (recSec?.body ?? md).match(/mint\s+\**\s*(AVI-\d+)\s+["“]([^"”]+)["”]/i);
  const childProposal = child ? { code: child[1].toUpperCase(), name: child[2].trim() } : null;

  const wedgeSentence = clean(find(/niche|wedge/i)?.body.match(/^>\s*(.+)$/m)?.[1] ?? "") || null;
  const nextAction = clean(find(/next action/i)?.body.trim().split("\n").find((l) => l.trim()) ?? "") || null;

  // Evidence table
  const evSec = find(/evidence ids?/i);
  const evidence: BriefEvidence[] = [];
  const et = evSec ? table(evSec.body, (h) => h[0] === "id" && h.some((x) => x.startsWith("claim"))) : null;
  if (et) {
    const col = (name: RegExp) => et.header.findIndex((h) => name.test(h));
    const ci = { claim: col(/^claim/), type: col(/^type/), grain: col(/^grain/), source: col(/^source/), date: col(/^date/), conf: col(/^confidence/), ver: col(/verified/) };
    for (const row of et.rows) {
      const code = clean(row[0] ?? "").toUpperCase();
      if (!/^E\d+$/.test(code)) continue;
      const get = (i: number) => (i >= 0 && row[i] !== undefined ? clean(row[i]) || null : null);
      const verifiedFlag = get(ci.ver);
      evidence.push({
        code, claim: get(ci.claim) ?? "(no claim text)", type: get(ci.type), grain: get(ci.grain), sourceText: get(ci.source),
        sourceUrl: firstUrl(get(ci.source)), dateText: get(ci.date), confidence: get(ci.conf), verifiedFlag,
        classification: evidenceLevel(verifiedFlag),
      });
    }
  } else warnings.push("No evidence table found.");

  return {
    opportunityCode, title: titleLine, version: head[2] ?? null, preparedOn, scoredVariant, wedgeScores, wedgeRationales,
    statedWeightedTotal, asFramedScores, evidenceConfidence, criticalBlockers, classificationNote, childProposal,
    wedgeSentence, nextAction, evidence, warnings,
  };
}

/**
 * Converts brief scores into AVI criteria. Evidence strength follows the brief's own
 * "Evidence confidence", capped because the research is AI-reported, not owner-verified:
 * Verified → credible secondary; Partial → credible secondary (demand: inference);
 * Unverified → inference (demand: unsupported). Gates stay "unknown" — a brief never satisfies them.
 */
export function toAviScore(
  scores: Partial<Record<CriterionKey, number>>,
  rationales: Partial<Record<CriterionKey, string>>,
  confidence: ParsedBrief["evidenceConfidence"],
  blockers: string | null,
): { criteria: CriterionScore[]; gates: GateAssessment[] } {
  const level = (k: CriterionKey): EvidenceLevel => {
    if (confidence === "Verified") return "credible_secondary";
    if (confidence === "Partial") return k === "demand" ? "inference" : "credible_secondary";
    return k === "demand" ? "unsupported" : "inference";
  };
  return {
    criteria: CRITERIA.map((c) => ({
      key: c.key, score: scores[c.key] ?? null, evidence: level(c.key), rationale: rationales[c.key] ?? "",
    })),
    gates: GATES.map((g) => ({
      key: g.key, status: "unknown" as const, evidence: "unsupported" as const,
      note: blockers ? `Research brief: ${blockers}`.slice(0, 1000) : "Not established by the research brief",
    })),
  };
}

import "server-only";
import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { parseBrief, toAviScore, type ParsedBrief } from "./researchBrief";
import { scoreOpportunity, type ScoreResult } from "./scoring";
import { activeScoringVersion, audit, nextCode, saveScore, UserError } from "./repo";
import { normalizeName } from "./similarity";

export const MAX_BRIEF_BYTES = 1024 * 1024;
export const DEFAULT_ANALYST = "Grok research agent (per owner)";

export function checkBriefUpload(name: string, bytes: Uint8Array): string | null {
  if (!/\.(md|markdown|txt)$/i.test(name)) return "Research briefs must be Markdown (.md) files.";
  if (bytes.byteLength === 0) return "The file is empty.";
  if (bytes.byteLength > MAX_BRIEF_BYTES) return "Research brief is larger than 1 MB.";
  return null;
}

export type BriefPlan = {
  sha256: string;
  parsed: ParsedBrief;
  alreadyImported: string | null;
  parent: { id: string; code: string; name: string } | null;
  parentScore: { label: string; result: ScoreResult } | null;
  child: { code: string; name: string; exists: { id: string; code: string } | null; score: { label: string; result: ScoreResult } | null } | null;
  evidence: { code: string; claim: string; classification: string; status: "new" | "duplicate" | "conflict" }[];
  warnings: string[];
};

export async function planBriefImport(sql: Sql, text: string): Promise<BriefPlan> {
  let parsed: ParsedBrief;
  try {
    parsed = parseBrief(text);
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : "Could not read the research brief.");
  }
  const sha256 = createHash("sha256").update(text).digest("hex");
  const warnings = [...parsed.warnings];
  const [prev] = await sql`select imported_at from research_briefs where content_sha256 = ${sha256}`;
  const [parent] = await sql`select id, code, name from opportunities where code = ${parsed.opportunityCode}`;
  if (!parent) warnings.push(`${parsed.opportunityCode} isn't in AVI yet. Import your register first, then this brief.`);

  const v = await activeScoringVersion(sql);
  const score = (scores: ParsedBrief["wedgeScores"] | null) => {
    if (!scores || Object.keys(scores).length < 6) return null;
    const s = toAviScore(scores, parsed.wedgeRationales, parsed.evidenceConfidence, parsed.criticalBlockers);
    return scoreOpportunity(s.criteria, s.gates, v.weights, v.thresholds);
  };

  let parentScore: BriefPlan["parentScore"] = null;
  let child: BriefPlan["child"] = null;
  if (parsed.childProposal) {
    const r = score(parsed.asFramedScores);
    if (r) parentScore = { label: `${parsed.opportunityCode} as framed`, result: r };
    else warnings.push(`The brief doesn't give separate scores for ${parsed.opportunityCode} as framed, so its score is left unchanged.`);
    const [byCode] = await sql`select id, code, name from opportunities where code = ${parsed.childProposal.code}`;
    const [byName] = await sql`select id, code from opportunities where normalized_name = ${normalizeName(parsed.childProposal.name)}`;
    const exists = byName ?? (byCode && normalizeName(byCode.name) === normalizeName(parsed.childProposal.name) ? byCode : null);
    if (byCode && !exists) warnings.push(`${parsed.childProposal.code} is already used by "${byCode.name}", so the new idea will get the next free code.`);
    const cr = score(parsed.wedgeScores);
    child = { ...parsed.childProposal, exists: exists ? { id: exists.id, code: exists.code } : null, score: cr ? { label: parsed.scoredVariant ?? "Scored wedge", result: cr } : null };
  } else {
    const r = score(parsed.wedgeScores);
    if (r) parentScore = { label: parsed.scoredVariant ?? "Scored wedge", result: r };
  }
  if (parsed.statedWeightedTotal !== null) {
    const ours = child?.score?.result.weightedTotal ?? (!parsed.childProposal ? parentScore?.result.weightedTotal : null);
    if (ours !== null && ours !== undefined && Math.abs(ours - parsed.statedWeightedTotal) > 0.05) {
      warnings.push(`The brief states ${parsed.statedWeightedTotal}/100 but AVI's active weights give ${ours}/100 for the same scores.`);
    }
  }

  const codes = parsed.evidence.map((e) => e.code);
  const existing = codes.length ? await sql`select code, import_key from evidence where code in ${sql(codes)}` : [];
  const evidence = parsed.evidence.map((e) => {
    const hit = existing.find((x) => x.code === e.code);
    const status = !hit ? "new" : hit.importKey === `brief:${e.code}` ? "duplicate" : "conflict";
    return { code: e.code, claim: e.claim, classification: e.classification, status } as const;
  });
  const conflicts = evidence.filter((e) => e.status === "conflict");
  if (conflicts.length) warnings.push(`Evidence ${conflicts.map((c) => c.code).join(", ")} already exists with different content and will be skipped.`);

  return {
    sha256, parsed, alreadyImported: prev ? new Date(prev.importedAt).toISOString() : null,
    parent: parent ? { id: parent.id, code: parent.code, name: parent.name } : null,
    parentScore, child, evidence, warnings,
  };
}

export async function commitBriefImport(sql: Sql, text: string, opts: { createChild: boolean; analyst?: string }) {
  const plan = await planBriefImport(sql, text);
  if (!plan.parent) throw new UserError(plan.warnings[0]);
  if (plan.alreadyImported) throw new UserError("This exact brief has already been imported.");
  const p = plan.parsed;
  const analyst = (opts.analyst || DEFAULT_ANALYST).slice(0, 200);
  const source = `Research brief ${p.opportunityCode} ${p.version ?? ""} · ${analyst}`.replace(/\s+/g, " ");

  return sql.begin(async (tx) => {
    let childId: string | null = null;
    let childCode: string | null = null;
    if (plan.child && opts.createChild) {
      if (plan.child.exists) {
        childId = plan.child.exists.id;
        childCode = plan.child.exists.code;
      } else {
        const free = (await tx`select 1 from opportunities where code = ${plan.child.code}`).length === 0;
        childCode = free ? plan.child.code : await nextCode(tx);
        const [c] = await tx`insert into opportunities ${tx({
          code: childCode, name: plan.child.name, normalizedName: normalizeName(plan.child.name),
          description: p.wedgeSentence, stage: "investigate", nextAction: p.nextAction,
          notes: `Child of ${plan.parent!.code} (${plan.parent!.name}), proposed by ${source}.`,
          importSource: source, importKey: `brief-child:${normalizeName(plan.child.name)}`,
        })} returning id`;
        childId = c.id;
        await audit(tx, "opportunity", childId, "created_from_research_brief", { parent: plan.parent!.code, source });
      }
      // keep code sequence ahead of explicit codes
      await tx`select setval('opportunity_code_seq', greatest((select coalesce(max(substring(code from 5)::int), 25)
        from opportunities where code ~ '^AVI-[0-9]+$'), 25))`;
    }

    const [brief] = await tx`insert into research_briefs ${tx({
      opportunityId: plan.parent!.id, opportunityCode: p.opportunityCode, title: p.title, version: p.version,
      analyst, preparedOn: p.preparedOn, content: text, contentSha256: plan.sha256,
      parsed: { ...p, childOpportunityId: childId, childOpportunityCode: childCode } as never,
    })} returning id`;

    let evidenceCreated = 0;
    for (const e of p.evidence) {
      if (plan.evidence.find((x) => x.code === e.code)?.status !== "new") continue;
      const [row] = await tx`insert into evidence ${tx({
        code: e.code, claim: e.claim, classification: e.classification,
        originalClassification: [e.type, e.verifiedFlag && `brief says verified: ${e.verifiedFlag}`, e.confidence && `confidence ${e.confidence}`].filter(Boolean).join(" · "),
        sourceUrl: e.sourceUrl, scope: e.dateText, limitations: e.sourceText, relevantTo: [p.opportunityCode, childCode].filter(Boolean).join(", "),
        sourceNote: `Reported by ${source}. AI research — check the source before treating it as verified.`,
        importKey: `brief:${e.code}`,
      })} on conflict do nothing returning id`;
      if (!row) continue;
      evidenceCreated++;
      for (const oid of [plan.parent!.id, childId].filter(Boolean) as string[]) {
        await tx`insert into opportunity_evidence (opportunity_id, evidence_id) values (${oid}, ${row.id}) on conflict do nothing`;
      }
    }

    const scored: string[] = [];
    if (plan.parentScore) {
      const sc = p.childProposal ? p.asFramedScores! : p.wedgeScores;
      const s = toAviScore(sc, p.childProposal ? {} : p.wedgeRationales, p.evidenceConfidence, p.criticalBlockers);
      await saveScore(plan.parent!.id, s.criteria, s.gates, `${source} (${plan.parentScore.label})`, tx);
      scored.push(plan.parent!.code);
    }
    if (childId && plan.child?.score) {
      const s = toAviScore(p.wedgeScores, p.wedgeRationales, p.evidenceConfidence, p.criticalBlockers);
      await saveScore(childId, s.criteria, s.gates, `${source} (${plan.child.score.label})`, tx);
      scored.push(childCode!);
    }
    await tx`insert into decision_history (opportunity_id, new_decision, reason, source)
      values (${plan.parent!.id}, 'Research brief imported', ${p.nextAction ?? p.title}, ${source})`;
    await audit(tx, "opportunity", plan.parent!.id, "research_brief_imported", { brief: brief.id, source, childCode, evidenceCreated, scored });
    return { briefId: brief.id, childCode, evidenceCreated, scored };
  });
}

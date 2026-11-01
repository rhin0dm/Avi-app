import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { getSql, ready } from "./db";
import { findSimilar, normalizeName } from "./similarity";
import {
  scoreOpportunity, validateWeights, DEFAULT_THRESHOLDS, emptyCriteria, emptyGates,
  type CriterionScore, type GateAssessment, type Weights, type Thresholds, type Decision,
} from "./scoring";
import {
  DEFAULT_INPUTS, DEFAULT_SCENARIOS, financialInputsSchema, scenariosSchema, runScenarios,
  type FinancialInputs, type Scenarios,
} from "./finance";
import type { IdeaInput, Stage, Runway } from "./validation";

type Db = Sql | TransactionSql;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// postgres.js serialises objects/arrays to jsonb from the described column type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (v: unknown): any => v ?? null;

export async function audit(db: Db, entity: string, entityId: string | null, action: string, changes?: unknown) {
  await db`insert into audit_log (entity, entity_id, action, changes) values (${entity}, ${entityId}, ${action}, ${j(changes)}::jsonb)`;
}

// ---------------------------------------------------------------- codes
export async function nextCode(db: Db): Promise<string> {
  for (let i = 0; i < 1000; i++) {
    const [{ n }] = await db`select nextval('opportunity_code_seq')::int as n`;
    const code = `AVI-${String(n).padStart(3, "0")}`;
    const [taken] = await db`select 1 from opportunities where code = ${code}`;
    if (!taken) return code;
  }
  throw new Error("Could not allocate an opportunity code");
}

// ---------------------------------------------------------------- scoring versions
export type ScoringVersion = { id: number; label: string; weights: Weights; thresholds: Thresholds; isActive: boolean; isLegacy: boolean; notes: string | null; createdAt: Date };

export async function activeScoringVersion(db: Db = getSql()): Promise<ScoringVersion> {
  const [v] = await db`select * from scoring_versions where is_active`;
  if (!v) throw new Error("No active scoring version");
  return { ...v, thresholds: { ...DEFAULT_THRESHOLDS, ...v.thresholds } } as ScoringVersion;
}
export async function listScoringVersions(): Promise<ScoringVersion[]> {
  await ready();
  return (await getSql()`select * from scoring_versions order by id desc`) as unknown as ScoringVersion[];
}
export async function createScoringVersion(label: string, weights: Weights, thresholds: Thresholds, notes?: string) {
  const errs = validateWeights(weights);
  if (errs.length) throw new UserError(errs.join("; "));
  if (!(thresholds.pass > thresholds.investigate && thresholds.investigate >= 0 && thresholds.pass <= 100)) {
    throw new UserError("PASS threshold must be above INVESTIGATE threshold, both 0–100");
  }
  return getSql().begin(async (tx) => {
    const [prev] = await tx`select id, label, weights, thresholds from scoring_versions where is_active`;
    await tx`update scoring_versions set is_active = false where is_active`;
    const [v] = await tx`insert into scoring_versions (label, weights, thresholds, is_active, notes)
      values (${label}, ${j(weights)}::jsonb, ${j(thresholds)}::jsonb, true, ${notes ?? null}) returning *`;
    await audit(tx, "scoring_version", String(v.id), "activated", { previous: prev, next: v });
    return v;
  });
}

// ---------------------------------------------------------------- opportunities
export class UserError extends Error {}

export async function createOpportunity(input: IdeaInput, db: Sql = getSql()) {
  const pool = await db`select id, code, name, description from opportunities where merged_into_id is null`;
  const similar = findSimilar(input.name, input.description, pool as unknown as { id: string; code: string; name: string; description: string | null }[]);
  const opp = await db.begin(async (tx) => {
    const code = await nextCode(tx);
    const [o] = await tx`insert into opportunities ${tx({
      code, name: input.name, normalizedName: normalizeName(input.name), description: input.description,
      targetMarket: input.targetMarket, proposedPricing: input.proposedPricing, budgetAud: input.budgetAud,
      userEvidence: input.userEvidence, relevantExperience: input.relevantExperience, notes: input.notes,
      track: input.track ?? null, stage: "idea",
    })} returning *`;
    await audit(tx, "opportunity", o.id, "created", { code, name: input.name, similar: similar.map((s) => s.code) });
    return o;
  });
  return { opportunity: opp, similar };
}

const PATCHABLE = [
  "name", "description", "coreHypothesis", "targetCustomer", "problem", "businessModels", "revenueMechanisms",
  "assumptions", "track", "customerContact", "targetMarket", "proposedPricing", "budgetAud", "userEvidence",
  "relevantExperience", "notes", "primaryRisks", "competitorLeads", "nextAction", "nextReviewDate", "owner",
  "revenueAssumptions", "actualTestSpendAud", "verifiedRevenueAud",
] as const;

export async function updateOpportunity(id: string, patch: Record<string, unknown>) {
  return getSql().begin(async (tx) => {
    const [before] = await tx`select * from opportunities where id = ${id} for update`;
    if (!before) throw new UserError("Opportunity not found");
    const set: Row = {};
    const diff: Row = {};
    for (const k of PATCHABLE) {
      if (!(k in patch)) continue;
      const nv = patch[k] ?? null;
      const ov = before[k] instanceof Date ? before[k].toISOString().slice(0, 10) : before[k];
      if (String(ov ?? "") !== String(nv ?? "")) {
        set[k] = nv;
        diff[k] = { from: ov ?? null, to: nv };
      }
    }
    if (Object.keys(set).length === 0) return before;
    if (set.name) set.normalizedName = normalizeName(String(set.name));
    set.updatedAt = new Date();
    const [after] = await tx`update opportunities set ${tx(set)} where id = ${id} returning *`;
    await audit(tx, "opportunity", id, "updated", diff);
    return after;
  });
}

export async function changeStage(id: string, stage: Stage, reason: string) {
  return getSql().begin(async (tx) => {
    const [o] = await tx`select stage from opportunities where id = ${id} for update`;
    if (!o) throw new UserError("Opportunity not found");
    if (o.stage === stage) return;
    await tx`update opportunities set stage = ${stage}, updated_at = now() where id = ${id}`;
    await tx`insert into decision_history (opportunity_id, old_decision, new_decision, reason, source)
      values (${id}, ${"Stage: " + o.stage}, ${"Stage: " + stage}, ${reason}, 'app')`;
    await audit(tx, "opportunity", id, "stage_changed", { from: o.stage, to: stage, reason });
  });
}

/** Merge `sourceId` into `targetId`. The source is archived, never deleted. */
export async function mergeOpportunities(sourceId: string, targetId: string, reason: string) {
  if (sourceId === targetId) throw new UserError("Cannot merge an opportunity into itself");
  return getSql().begin(async (tx) => {
    const [s] = await tx`select id, code, stage, merged_into_id from opportunities where id = ${sourceId} for update`;
    const [t] = await tx`select id, code, merged_into_id from opportunities where id = ${targetId}`;
    if (!s || !t) throw new UserError("Opportunity not found");
    if (t.mergedIntoId) throw new UserError(`${t.code} has itself been merged; merge into its successor instead`);
    await tx`update opportunities set merged_into_id = ${targetId}, stage = 'archive', updated_at = now() where id = ${sourceId}`;
    await tx`insert into opportunity_evidence (opportunity_id, evidence_id)
      select ${targetId}, evidence_id from opportunity_evidence where opportunity_id = ${sourceId} on conflict do nothing`;
    const note = `Merged ${s.code} into ${t.code}: ${reason}`;
    await tx`insert into decision_history (opportunity_id, old_decision, new_decision, reason, source) values
      (${sourceId}, ${"Stage: " + s.stage}, 'Merged / archived', ${note}, 'app'),
      (${targetId}, null, ${"Absorbed " + s.code}, ${note}, 'app')`;
    await audit(tx, "opportunity", sourceId, "merged", { into: t.code, reason });
    await audit(tx, "opportunity", targetId, "absorbed", { from: s.code, reason });
  });
}

export async function reopenOpportunity(id: string, reason: string) {
  return getSql().begin(async (tx) => {
    const [o] = await tx`select stage, merged_into_id from opportunities where id = ${id} for update`;
    if (!o) throw new UserError("Opportunity not found");
    await tx`update opportunities set stage = 'investigate', merged_into_id = null, updated_at = now() where id = ${id}`;
    await tx`insert into decision_history (opportunity_id, old_decision, new_decision, reason, source)
      values (${id}, ${"Stage: " + o.stage}, 'Reopened → investigate', ${reason}, 'app')`;
    await audit(tx, "opportunity", id, "reopened", { fromStage: o.stage, wasMergedInto: o.mergedIntoId, reason });
  });
}

// ---------------------------------------------------------------- scores
export async function saveScore(id: string, criteria: CriterionScore[], gates: GateAssessment[], source = "Owner (manual)", db?: TransactionSql) {
  await ready();
  const run = async (tx: Db) => {
    const v = await activeScoringVersion(tx);
    const result = scoreOpportunity(criteria, gates, v.weights, v.thresholds);
    const [prev] = await tx`select weighted_total, decision from scores where opportunity_id = ${id} and is_current and decision <> 'LEGACY'`;
    await tx`update scores set is_current = false where opportunity_id = ${id} and is_current and decision <> 'LEGACY'`;
    const [s] = await tx`insert into scores (opportunity_id, scoring_version_id, criteria, gates, weighted_total,
      evidence_confidence, decision, decision_reasons, is_current, source)
      values (${id}, ${v.id}, ${j(criteria)}::jsonb, ${j(gates)}::jsonb, ${result.weightedTotal},
      ${result.evidenceConfidence}, ${result.decision}, ${j(result.reasons)}::jsonb, true, ${source}) returning *`;
    if (!prev || prev.decision !== result.decision || Number(prev.weightedTotal) !== result.weightedTotal) {
      await tx`insert into decision_history (opportunity_id, old_score, new_score, old_decision, new_decision, reason, source)
        values (${id}, ${prev?.weightedTotal ?? null}, ${result.weightedTotal}, ${prev?.decision ?? null}, ${result.decision},
        ${result.reasons.join(" ")}, ${`Scoring: ${v.label} · ${source}`})`;
    }
    await audit(tx, "opportunity", id, "scored", { version: v.label, total: result.weightedTotal, decision: result.decision, source });
    return { score: s, result };
  };
  return db ? run(db) : getSql().begin(run);
}

/** Re-run every current score under the active weights. Inputs are unchanged, only weights differ. */
export async function rescoreAll() {
  const sql = getSql();
  const v = await activeScoringVersion();
  const stale = await sql`select opportunity_id, criteria, gates, source from scores
    where is_current and decision <> 'LEGACY' and scoring_version_id <> ${v.id}`;
  let changed = 0;
  for (const s of stale) {
    await saveScore(s.opportunityId, s.criteria, s.gates, `${s.source ?? "Owner (manual)"} (rescored)`);
    changed++;
  }
  return { rescored: changed, version: v.label };
}

// ---------------------------------------------------------------- financial model
export async function getFinancialModel(id: string): Promise<{ inputs: FinancialInputs; scenarios: Scenarios; saved: boolean }> {
  const [m] = await getSql()`select inputs, scenarios from financial_models where opportunity_id = ${id}`;
  if (!m) return { inputs: DEFAULT_INPUTS, scenarios: DEFAULT_SCENARIOS, saved: false };
  return { inputs: financialInputsSchema.parse(m.inputs), scenarios: scenariosSchema.parse(m.scenarios), saved: true };
}
export async function saveFinancialModel(id: string, inputs: FinancialInputs, scenarios: Scenarios) {
  const i = financialInputsSchema.parse(inputs);
  const s = scenariosSchema.parse(scenarios);
  return getSql().begin(async (tx) => {
    const [o] = await tx`select 1 from opportunities where id = ${id}`;
    if (!o) throw new UserError("Opportunity not found");
    const [prev] = await tx`select inputs, scenarios from financial_models where opportunity_id = ${id}`;
    await tx`insert into financial_models (opportunity_id, inputs, scenarios) values (${id}, ${j(i)}::jsonb, ${j(s)}::jsonb)
      on conflict (opportunity_id) do update set inputs = excluded.inputs, scenarios = excluded.scenarios, updated_at = now()`;
    await audit(tx, "opportunity", id, "financial_model_saved", { previous: prev ?? null, inputs: i, scenarios: s });
  });
}

// ---------------------------------------------------------------- reads
export type OpportunityListItem = Row & {
  id: string; code: string; name: string; stage: Stage; decision: Decision; weightedTotal: number | null;
  evidenceConfidence: number | null; legacyRank: number | null; legacyScore: number | null;
};

export async function listOpportunities(opts: { includeMerged?: boolean } = {}): Promise<OpportunityListItem[]> {
  await ready();
  const sql = getSql();
  const rows = await sql`
    select o.*, s.weighted_total, s.evidence_confidence, coalesce(s.decision, 'UNSCORED') as decision,
      s.scoring_version_id, s.created_at as scored_at, sv.label as scoring_version_label,
      (s.scoring_version_id is not null and s.scoring_version_id <> (select id from scoring_versions where is_active)) as score_stale,
      fm.inputs as fin_inputs, fm.scenarios as fin_scenarios,
      m.code as merged_into_code
    from opportunities o
    left join scores s on s.opportunity_id = o.id and s.is_current and s.decision <> 'LEGACY'
    left join scoring_versions sv on sv.id = s.scoring_version_id
    left join financial_models fm on fm.opportunity_id = o.id
    left join opportunities m on m.id = o.merged_into_id
    ${opts.includeMerged ? sql`` : sql`where o.merged_into_id is null`}
    order by o.legacy_rank nulls last, o.created_at`;
  return rows.map((r) => {
    let baseOwnerEarningsY2: number | null = null;
    if (r.finInputs) {
      try {
        const sc = runScenarios(financialInputsSchema.parse(r.finInputs), scenariosSchema.parse(r.finScenarios));
        baseOwnerEarningsY2 = sc.base.ownerEarningsYear2;
      } catch { /* invalid stored model is shown as missing */ }
    }
    return { ...r, baseOwnerEarningsY2 } as unknown as OpportunityListItem;
  });
}

export async function getOpportunity(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  await ready();
  const sql = getSql();
  const [o] = await sql`select o.*, m.code as merged_into_code, m.name as merged_into_name
    from opportunities o left join opportunities m on m.id = o.merged_into_id where o.id = ${id}`;
  if (!o) return null;
  // Sequential on purpose: one connection at a time is kinder to hosted transaction poolers.
  const scores = await sql`select s.*, v.label as version_label, v.weights as version_weights from scores s
      join scoring_versions v on v.id = s.scoring_version_id where s.opportunity_id = ${id} order by s.created_at desc`;
  const evidence = await sql`select e.* from evidence e join opportunity_evidence oe on oe.evidence_id = e.id where oe.opportunity_id = ${id} order by e.code`;
  const experiments = await sql`select * from experiments where opportunity_id = ${id} order by code`;
  const decisions = await sql`select * from decision_history where opportunity_id = ${id} order by created_at desc`;
  const auditRows = await sql`select * from audit_log where entity = 'opportunity' and entity_id = ${id} order by at desc limit 100`;
  const jobs = await sql`select * from jobs where opportunity_id = ${id} order by created_at desc limit 20`;
  const mergedFrom = await sql`select id, code, name from opportunities where merged_into_id = ${id}`;
  const version = await activeScoringVersion();
  const fin = await getFinancialModel(id);
  const briefs = await sql`select id, kind, title, version, analyst, prepared_on, content, parsed, imported_at
    from research_briefs where opportunity_id = ${id} or parsed->>'childOpportunityId' = ${id} order by imported_at desc`;
  const competitors = await sql`select * from competitors where opportunity_id = ${id} order by alt_type nulls last, name`;
  const related = await sql`select id, code, name, stage from opportunities
    where (parent_code = ${o.code} or code = ${o.parentCode ?? ""}) and id <> ${id} order by code`;
  const current = scores.find((s) => s.isCurrent && s.decision !== "LEGACY") ?? null;
  return {
    opportunity: o, currentScore: current, scoreHistory: scores, evidence, experiments, decisions,
    audit: auditRows, jobs, mergedFrom, activeVersion: version, financial: fin, briefs, competitors,
    parent: related.find((r) => r.code === o.parentCode) ?? null, children: related.filter((r) => r.code !== o.parentCode),
    scoreDraft: {
      criteria: (current?.criteria as CriterionScore[]) ?? emptyCriteria(),
      gates: (current?.gates as GateAssessment[]) ?? emptyGates(),
    },
  };
}

// ---------------------------------------------------------------- settings / dashboard
export async function getRunway(): Promise<Runway> {
  await ready();
  const [r] = await getSql()`select value from settings where key = 'runway'`;
  return r?.value ?? { savingsAud: null, monthlyPersonalSpendAud: null, resignationDate: "2027-02-28", currentSalaryAud: 160000 };
}
export async function saveRunway(v: Runway) {
  await getSql().begin(async (tx) => {
    const [prev] = await tx`select value from settings where key = 'runway'`;
    await tx`insert into settings (key, value) values ('runway', ${j(v)}::jsonb)
      on conflict (key) do update set value = excluded.value, updated_at = now()`;
    await audit(tx, "settings", "runway", "updated", { from: prev?.value, to: v });
  });
}

export async function dashboardData() {
  await ready();
  const sql = getSql();
  const [opps, experiments, runway, recentDecisions] = await Promise.all([
    listOpportunities(),
    sql`select e.*, o.code as opp_code, o.name as opp_name, o.id as opp_id from experiments e left join opportunities o on o.id = e.opportunity_id order by e.code`,
    getRunway(),
    sql`select d.*, o.code, o.name from decision_history d left join opportunities o on o.id = d.opportunity_id order by d.created_at desc limit 8`,
  ]);
  return { opps, experiments, runway, recentDecisions };
}

// ---------------------------------------------------------------- comparison
export async function compareData(ids: string[]) {
  await ready();
  const clean = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 6);
  if (!clean.length) return [];
  const all = await listOpportunities({ includeMerged: true });
  const scores = await getSql()`select opportunity_id, criteria, gates from scores where is_current and decision <> 'LEGACY' and opportunity_id in ${getSql()(clean)}`;
  return clean.map((id) => {
    const o = all.find((x) => x.id === id);
    if (!o) return null;
    const s = scores.find((x) => x.opportunityId === id);
    let fin = null;
    if (o.finInputs) {
      try { fin = runScenarios(financialInputsSchema.parse(o.finInputs), scenariosSchema.parse(o.finScenarios)); } catch { /* ignore */ }
    }
    return {
      id, code: o.code, name: o.name, stage: o.stage, decision: o.decision as Decision,
      weightedTotal: o.weightedTotal === null ? null : Number(o.weightedTotal),
      evidenceConfidence: o.evidenceConfidence === null ? null : Number(o.evidenceConfidence),
      customerContact: o.customerContact ?? null, legacyRank: o.legacyRank, legacyScore: o.legacyScore === null ? null : Number(o.legacyScore),
      criteria: (s?.criteria ?? []) as CriterionScore[], gates: (s?.gates ?? []) as GateAssessment[],
      startup: o.finInputs ? Number(o.finInputs.startupInvestment ?? 0) : null,
      ownerEarningsY2: fin ? { conservative: fin.conservative.ownerEarningsYear2, base: fin.base.ownerEarningsYear2, optimistic: fin.optimistic.ownerEarningsYear2 } : null,
      peakCash: fin?.base.peakCashRequired ?? null, breakEven: fin?.base.breakEvenMonth ?? null,
    };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
}

// ---------------------------------------------------------------- evidence library
export async function listEvidence() {
  await ready();
  return getSql()`select e.*, coalesce(json_agg(json_build_object('id', o.id, 'code', o.code)) filter (where o.id is not null), '[]') as links
    from evidence e left join opportunity_evidence oe on oe.evidence_id = e.id left join opportunities o on o.id = oe.opportunity_id
    group by e.id order by e.code nulls last, e.created_at`;
}
export async function linkEvidence(evidenceId: string, opportunityId: string, link: boolean) {
  return getSql().begin(async (tx) => {
    const [e] = await tx`select code from evidence where id = ${evidenceId}`;
    if (!e) throw new UserError("Evidence not found");
    if (link) await tx`insert into opportunity_evidence (opportunity_id, evidence_id) values (${opportunityId}, ${evidenceId}) on conflict do nothing`;
    else await tx`delete from opportunity_evidence where opportunity_id = ${opportunityId} and evidence_id = ${evidenceId}`;
    await audit(tx, "opportunity", opportunityId, link ? "evidence_linked" : "evidence_unlinked", { evidence: e.code });
  });
}
export async function listNicheScans() {
  await ready();
  return getSql()`select * from niche_scans order by scan_id`;
}

export async function classifyEvidence(evidenceId: string, classification: string) {
  return getSql().begin(async (tx) => {
    const [e] = await tx`select classification from evidence where id = ${evidenceId} for update`;
    if (!e) throw new UserError("Evidence not found");
    await tx`update evidence set classification = ${classification} where id = ${evidenceId}`;
    await audit(tx, "evidence", evidenceId, "reclassified", { from: e.classification, to: classification });
  });
}

import "server-only";
import type { Sql } from "postgres";
import type { SheetData } from "./xlsxReader";
import { parseTracker, trackerStatus, type TrackerResult } from "./experimentTracker";
import { audit, saveScore, UserError } from "./repo";
import type { CriterionScore, GateAssessment } from "./scoring";

export type TrackerPlan = {
  kind: "tracker";
  tracker: TrackerResult;
  experiment: { id: string; code: string; status: string; opportunityId: string | null; opportunityCode: string | null } | null;
  newStatus: string | null;
  willRecordEvidence: string[];
  willUpdateScore: boolean;
  warnings: string[];
};

export async function planTracker(sql: Sql, sheets: SheetData[], filename: string): Promise<TrackerPlan> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: process.env.APP_TIMEZONE ?? "Australia/Hobart" });
  const t = parseTracker(sheets, filename, today);
  const warnings = [...t.warnings];
  let experiment: TrackerPlan["experiment"] = null;
  if (t.experimentCode) {
    const [x] = await sql`select e.id, e.code, e.status, e.opportunity_id, o.code as opp_code from experiments e
      left join opportunities o on o.id = e.opportunity_id where lower(e.code) = lower(${t.experimentCode})`;
    if (x) experiment = { id: x.id, code: x.code, status: x.status, opportunityId: x.opportunityId, opportunityCode: x.oppCode };
    else warnings.push(`${t.experimentCode} isn't in AVI yet. Import your latest register first, then this tracking sheet.`);
  }
  if (experiment && t.opportunityCode && experiment.opportunityCode && experiment.opportunityCode !== t.opportunityCode) {
    warnings.push(`The sheet says ${t.opportunityCode} but AVI has ${experiment.code} under ${experiment.opportunityCode}; AVI's link is kept.`);
  }
  if (t.spend.over) warnings.push(`Spend A$${t.spend.spent} is over the A$${t.spend.ceiling} ceiling.`);
  const willRecordEvidence = [
    ...(t.phaseA.decision !== "PENDING" ? ["Your Phase A timing results"] : []),
    ...(t.phaseB.paidPractices > 0 ? ["Paid pilots (counts as verified demand)"] : []),
  ];
  return {
    kind: "tracker", tracker: t, experiment,
    newStatus: experiment ? trackerStatus(t, experiment.status) : null,
    willRecordEvidence, willUpdateScore: t.phaseB.decision === "SUCCESS" && Boolean(experiment?.opportunityId), warnings,
  };
}

const money = (n: number) => `A$${n.toLocaleString("en-AU", { maximumFractionDigits: 2 })}`;

export async function commitTracker(sql: Sql, plan: TrackerPlan, filename: string) {
  const x = plan.experiment;
  if (!x) throw new UserError(plan.warnings[0] ?? "No matching experiment in AVI.");
  const t = plan.tracker;
  return sql.begin(async (tx) => {
    const [prev] = await tx`select tracking from experiments where id = ${x.id} for update`;
    const before = prev?.tracking as TrackerResult | null;
    const resultText = [
      `Phase A: ${t.phaseA.decision}${t.phaseA.medianManualMin !== null ? ` — median ${t.phaseA.medianManualMin} min/file over ${t.phaseA.filesTimed} files` : ""}${t.phaseA.removedPct !== null ? `, tools remove ${t.phaseA.removedPct}%` : ""}.`,
      t.phaseB.decision !== "NOT STARTED" ? `Phase B: ${t.phaseB.decision} — ${t.phaseB.paidPractices} paying practices, ${t.phaseB.paidFiles} files, ${money(t.phaseB.revenueExGst)} ex GST from ${t.phaseB.outreach} outreaches.` : "",
    ].filter(Boolean).join(" ");
    await tx`update experiments set tracking = ${t as never}, tracking_updated_at = now(), status = ${plan.newStatus ?? x.status},
      actual_spend_aud = ${t.spend.spent}, result = ${resultText} where id = ${x.id}`;

    // Decision history whenever a phase decision changes
    const changes: [string, string, string][] = [];
    if (before?.phaseA?.decision !== t.phaseA.decision && t.phaseA.decision !== "PENDING") changes.push([`${x.code} phase A`, before?.phaseA?.decision ?? "PENDING", t.phaseA.decision]);
    if (before?.phaseB?.decision !== t.phaseB.decision && t.phaseB.decision !== "NOT STARTED") changes.push([`${x.code} phase B`, before?.phaseB?.decision ?? "NOT STARTED", t.phaseB.decision]);
    for (const [label, from, to] of changes) {
      const reasons = label.endsWith("A") ? t.phaseA.reasons : t.phaseB.reasons;
      await tx`insert into decision_history (opportunity_id, old_decision, new_decision, reason, source)
        values (${x.opportunityId}, ${`${label}: ${from}`}, ${`${label}: ${to}`}, ${reasons.join(" ")}, ${`Tracking sheet ${filename}`})`;
    }

    // Owner-measured results become evidence on the idea (counts only, no client data)
    const upsertEvidence = async (suffix: string, claim: string, classification: string, note: string) => {
      const code = `${x.code}-${suffix}`;
      const [row] = await tx`insert into evidence (code, claim, classification, original_classification, scope, relevant_to, source_note, import_key)
        values (${code}, ${claim}, ${classification}, ${"Owner's experiment tracking sheet"}, ${new Date().toISOString().slice(0, 10)},
        ${x.opportunityCode}, ${note}, ${`tracker:${code}`})
        on conflict (import_key) do update set claim = excluded.claim, classification = excluded.classification, scope = excluded.scope
        returning id`;
      if (x.opportunityId) await tx`insert into opportunity_evidence (opportunity_id, evidence_id) values (${x.opportunityId}, ${row.id}) on conflict do nothing`;
    };
    if (t.phaseA.decision !== "PENDING") {
      await upsertEvidence("TIME", `Manual exception clearing took a median ${t.phaseA.medianManualMin} min per file across ${t.phaseA.filesTimed} real Q1 files; existing tools would remove about ${t.phaseA.removedPct}% of that time (owner estimate). Median ${t.phaseA.medianExceptions ?? "?"} exceptions per file.`,
        "verified", "Measured by the owner on real files (counts and minutes only). The tool-savings share is the owner's estimate.");
    }
    if (t.phaseB.paidPractices > 0) {
      await upsertEvidence("PAID", `${t.phaseB.paidPractices} practice(s) paid ${money(t.phaseB.revenueExGst)} ex GST for ${t.phaseB.paidFiles} file(s)${t.phaseB.refunds ? `, ${t.phaseB.refunds} refunded (${money(t.phaseB.refundTotal)})` : ""}.`,
        "verified", "Payments recorded by the owner in the experiment tracking sheet — direct buyer evidence.");
    }

    // Paid-pilot success settles the willingness-to-pay question on the current score
    let scoreUpdated = false;
    if (plan.willUpdateScore && x.opportunityId) {
      const [cur] = await tx`select criteria, gates from scores where opportunity_id = ${x.opportunityId} and is_current and decision <> 'LEGACY'`;
      if (cur) {
        const criteria = (cur.criteria as CriterionScore[]).map((c) => c.key === "demand" ? { ...c, evidence: "verified" as const } : c);
        const gates = (cur.gates as GateAssessment[]).map((g) => g.key === "willingness_to_pay"
          ? { ...g, status: "satisfied" as const, evidence: "verified" as const, note: `${x.code}: ${t.phaseB.reasons.join(" ")}` } : g);
        if (JSON.stringify(criteria) !== JSON.stringify(cur.criteria) || JSON.stringify(gates) !== JSON.stringify(cur.gates)) {
          await saveScore(x.opportunityId, criteria, gates, `${x.code} tracking sheet (paid pilots)`, tx);
          scoreUpdated = true;
        }
      }
    }
    await audit(tx, "experiment", x.id, "tracking_sheet_imported", { file: filename, phaseA: t.phaseA.decision, phaseB: t.phaseB.decision, status: plan.newStatus });
    return { experiment: x.code, status: plan.newStatus, phaseA: t.phaseA.decision, phaseB: t.phaseB.decision, decisionsLogged: changes.length, scoreUpdated };
  });
}

"use client";
import { btnPrimary } from "@/components/ui";
import type { TrackerPlan } from "@/lib/trackerImport";

const tone = (d: string) => /PASS|SUCCESS/.test(d) ? "bg-pass-soft text-pass" : /STOP/.test(d) ? "bg-fail-soft text-fail" : "bg-inv-soft text-inv";
const v = (n: number | null, unit = "") => (n === null ? "—" : `${n}${unit}`);

export function TrackerPreview({ plan, busy, onImport }: { plan: TrackerPlan; busy: boolean; onImport: () => void }) {
  const t = plan.tracker;
  const a = t.phaseA, b = t.phaseB;
  return (
    <div className="space-y-3 rounded-lg bg-paper p-3">
      <p><b>Experiment tracking sheet</b> · {t.experimentCode ?? "unknown experiment"}{t.opportunityCode ? ` for ${t.opportunityCode}` : ""}</p>
      <div className="rounded-md border border-line bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><b>Phase A — time and tools</b><span className={`rounded px-2 py-0.5 text-xs font-semibold ${tone(a.decision)}`}>{a.decision}</span></div>
        <ul className="mt-1 text-xs">
          <li>Files timed: {a.filesTimed} of {a.filesExpected} · tool comparison: {a.filesWithToolData}</li>
          <li>Median manual clear: {v(a.medianManualMin, " min")} (pass ≥{t.rules.passMedianMin}, stop &lt;{t.rules.stopMedianMin})</li>
          <li>Time left after tools: {v(a.residualPct, "%")} (pass ≥{t.rules.passResidualPct}%; stop if tools remove &gt;{t.rules.stopRemovedPct}%)</li>
          <li>Median exceptions per file: {v(a.medianExceptions)}</li>
        </ul>
        {a.reasons.length > 0 && <p className="mt-1 text-xs text-muted">{a.reasons.join(" ")}</p>}
      </div>
      <div className="rounded-md border border-line bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><b>Phase B — paid pilots</b><span className={`rounded px-2 py-0.5 text-xs font-semibold ${tone(b.decision)}`}>{b.decision}</span></div>
        <ul className="mt-1 text-xs">
          <li>Outreach: {b.outreach} · replies: {b.replies} · paying practices: {b.paidPractices} (need {t.rules.successPractices})</li>
          <li>Files paid: {b.paidFiles} (need {t.rules.successFiles}) · revenue A${b.revenueExGst} ex GST</li>
          <li>Owner minutes per file, average: {v(b.ownerMinPerFile)} (max {t.rules.maxOwnerMinPerFile}) · lodgement-ready: {v(b.avgLodgementScore, "/5")} (need {t.rules.minLodgementScore})</li>
        </ul>
        {t.rules.phaseBEnd && <p className="mt-1 text-xs text-muted">Window closes {t.rules.phaseBEnd}. After that, 1+ paying practices short of the bar = investigate more; none = stop.</p>}
        {b.reasons.length > 0 && <p className="mt-1 text-xs text-muted">{b.reasons.join(" ")}</p>}
      </div>
      <p className="text-xs">Spend: A${t.spend.spent}{t.spend.ceiling !== null ? ` of A$${t.spend.ceiling}` : ""}</p>
      {plan.experiment && <p className="text-xs">AVI will set {plan.experiment.code} to <b>{plan.newStatus}</b>{plan.willRecordEvidence.length ? ` and record: ${plan.willRecordEvidence.join("; ")}` : ""}.{plan.willUpdateScore ? " The idea's score will count demand as verified." : ""}</p>}
      {plan.warnings.length > 0 && <ul className="list-disc pl-5 text-inv">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      <p className="text-xs text-muted">Only counts, minutes and totals are read — no practice names or notes are stored.</p>
      <button className={btnPrimary} disabled={busy || !plan.experiment} onClick={onImport}>{busy ? "Updating…" : `Update ${plan.experiment?.code ?? "experiment"}`}</button>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getOpportunity, listOpportunities } from "@/lib/repo";
import { providerStatus } from "@/lib/ai/providers";
import { DecisionBadge, StageBadge } from "@/components/ui";
import { date, isoDay, num, pct } from "@/lib/format";
import { Tabs } from "./Tabs";
import { OverviewForm } from "./OverviewForm";
import { ScoreEditor } from "./ScoreEditor";
import { FinancialEditor } from "./FinancialEditor";
import { Actions } from "./Actions";
import { Interpretation } from "./Interpretation";
import { EvidencePanel } from "./EvidencePanel";

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getOpportunity(id);
  if (!d) notFound();
  const o = d.opportunity;
  const cur = d.currentScore;
  const decision = cur?.decision ?? "UNSCORED";
  const others = (await listOpportunities()).filter((x) => x.id !== id).map((x) => ({ id: x.id, code: x.code, name: x.name }));

  const fields = {
    name: o.name, description: o.description, coreHypothesis: o.coreHypothesis, targetCustomer: o.targetCustomer, problem: o.problem,
    businessModels: o.businessModels, revenueMechanisms: o.revenueMechanisms, assumptions: o.assumptions, track: o.track,
    customerContact: o.customerContact, targetMarket: o.targetMarket, proposedPricing: o.proposedPricing, budgetAud: o.budgetAud,
    userEvidence: o.userEvidence, relevantExperience: o.relevantExperience, notes: o.notes, primaryRisks: o.primaryRisks,
    competitorLeads: o.competitorLeads, nextAction: o.nextAction, nextReviewDate: isoDay(o.nextReviewDate), owner: o.owner,
    revenueAssumptions: o.revenueAssumptions, actualTestSpendAud: o.actualTestSpendAud, verifiedRevenueAud: o.verifiedRevenueAud,
  };

  return (
    <>
      <div className="mb-1 text-sm"><Link href="/opportunities" className="text-muted hover:text-ink">← Register</Link></div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="font-mono">{o.code}</span><StageBadge stage={o.stage} />
            {o.track && <span>{o.track[0].toUpperCase() + o.track.slice(1)} track</span>}
          </div>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">{o.name}</h1>
          {o.mergedIntoId && <p className="mt-1 text-sm text-inv">Merged into <Link className="underline" href={`/opportunities/${o.mergedIntoId}`}>{o.mergedIntoCode} {o.mergedIntoName}</Link></p>}
          {d.mergedFrom.length > 0 && <p className="mt-1 text-sm text-muted">Absorbed: {d.mergedFrom.map((m) => <Link key={m.id} className="mr-2 underline" href={`/opportunities/${m.id}`}>{m.code}</Link>)}</p>}
        </div>
        <div className="sm:text-right">
          <DecisionBadge decision={decision} size="lg" />
          <div className="mt-1 text-sm tabular">
            {cur?.weightedTotal !== null && cur?.weightedTotal !== undefined ? <><b>{num(Number(cur.weightedTotal), 2)}</b>/100 · evidence {pct(cur.evidenceConfidence)}</> : <span className="text-muted">Not scored under {d.activeVersion.label}</span>}
          </div>
          {o.legacyScore !== null && <div className="text-xs text-muted">Original screening: #{o.legacyRank} · {num(Number(o.legacyScore))}/100 (subjective)</div>}
          {cur && cur.scoringVersionId !== d.activeVersion.id && <div className="text-xs text-inv">Scored under older weights ({cur.versionLabel})</div>}
        </div>
      </div>

      {cur && (cur.decisionReasons as string[]).length > 0 && (
        <div className={`mb-4 rounded-xl border p-3 text-sm ${decision === "PASS" ? "border-pass/30 bg-pass-soft" : decision === "FAIL" ? "border-fail/30 bg-fail-soft" : "border-inv/30 bg-inv-soft"}`}>
          <b>Why {decision}:</b>
          <ul className="mt-1 list-disc pl-5">{(cur.decisionReasons as string[]).map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}

      <Interpretation id={id} status={o.interpretationStatus} data={o.interpretation} aiConfigured={providerStatus().configured} />

      <Tabs tabs={[
        { key: "overview", label: "Overview", content: <OverviewForm id={id} initial={fields} legacy={{ decision: o.legacyDecision, validation: o.legacyValidationStatus, evidence: o.legacyEvidenceStatus, source: o.importSource, raw: o.importRaw }} /> },
        { key: "score", label: "Score", content: <ScoreEditor id={id} initial={d.scoreDraft} weights={d.activeVersion.weights} thresholds={d.activeVersion.thresholds} versionLabel={d.activeVersion.label} /> },
        { key: "financials", label: "Financials", content: <FinancialEditor id={id} initial={d.financial} /> },
        { key: "evidence", label: `Evidence (${d.evidence.length})`, content: <EvidencePanel evidence={d.evidence} experiments={d.experiments} /> },
        {
          key: "history", label: "History", content: (
            <div className="space-y-5 text-sm">
              <section>
                <h3 className="mb-2 font-semibold">Decisions</h3>
                {d.decisions.length === 0 ? <p className="text-muted">None yet.</p> : (
                  <ul className="divide-y divide-line">{d.decisions.map((x) => (
                    <li key={x.id} className="py-2"><span className="text-muted">{date(x.decidedOn)} · {x.source}</span><br />
                      {x.oldDecision ? `${x.oldDecision}${x.oldScore ? ` (${x.oldScore})` : ""} → ` : ""}<b>{x.newDecision}</b>{x.newScore ? ` (${x.newScore})` : ""}
                      {x.reason && <div className="text-xs text-muted">{x.reason}</div>}</li>))}</ul>
                )}
              </section>
              <section>
                <h3 className="mb-2 font-semibold">Score versions</h3>
                {d.scoreHistory.length === 0 ? <p className="text-muted">None yet.</p> : (
                  <ul className="divide-y divide-line">{d.scoreHistory.map((s) => (
                    <li key={s.id} className="flex justify-between gap-2 py-2"><span>{date(s.createdAt)} · {s.versionLabel}{s.isCurrent && s.decision !== "LEGACY" ? " · current" : ""}</span>
                      <span className="tabular">{s.weightedTotal !== null ? num(Number(s.weightedTotal), 2) : "—"} · {s.decision}</span></li>))}</ul>
                )}
              </section>
              <section>
                <h3 className="mb-2 font-semibold">Audit trail</h3>
                <ul className="divide-y divide-line">{d.audit.map((a) => (
                  <li key={a.id} className="py-2"><span className="text-muted">{new Date(a.at).toLocaleString("en-AU")}</span> · <b>{a.action.replace(/_/g, " ")}</b>
                    {a.changes && a.action === "updated" && <div className="text-xs text-muted">{Object.keys(a.changes).join(", ")}</div>}
                  </li>))}</ul>
              </section>
              <section>
                <h3 className="mb-2 font-semibold">Jobs</h3>
                {d.jobs.length === 0 ? <p className="text-muted">No jobs.</p> : <ul>{d.jobs.map((j) => <li key={j.id}>{date(j.createdAt)} · {j.kind} · <b>{j.status}</b>{j.error ? ` — ${j.error}` : ""}</li>)}</ul>}
              </section>
            </div>
          ),
        },
        { key: "actions", label: "Stage & merge", content: <Actions id={id} stage={o.stage} merged={Boolean(o.mergedIntoId)} others={others} /> },
      ]} />
    </>
  );
}

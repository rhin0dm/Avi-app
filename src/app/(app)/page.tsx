import Link from "next/link";
import { dashboardData, upcomingSteps, type OpportunityListItem } from "@/lib/repo";
import { PlanSteps } from "@/components/PlanSteps";
import { Card, DecisionBadge, PageHeader, Stat, StageBadge, btnPrimary } from "@/components/ui";
import { date, isoDay, money, num, pct } from "@/lib/format";

export const metadata = { title: "Decision Centre" };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: process.env.APP_TIMEZONE ?? "Australia/Hobart" });
const ACTIVE_STAGES = ["idea", "research", "investigate", "validation", "build", "launch", "scale"];
const DEV_STAGES = ["build", "launch", "scale"];
const EARLY_STAGES = ["idea", "research", "investigate"];

function OppLine({ o, extra }: { o: OpportunityListItem; extra?: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <Link href={`/opportunities/${o.id}`} className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium hover:text-accent">{o.name}</div>
        <div className="text-xs text-muted">{o.code}{extra ? <> · {extra}</> : null}</div>
      </Link>
      <DecisionBadge decision={o.decision} />
    </li>
  );
}

function List({ items, empty, render }: { items: OpportunityListItem[]; empty: string; render?: (o: OpportunityListItem) => React.ReactNode }) {
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>;
  return <ul className="divide-y divide-line">{items.slice(0, 6).map((o) => <OppLine key={o.id} o={o} extra={render?.(o)} />)}{items.length > 6 && <li className="pt-2 text-xs text-muted">+{items.length - 6} more</li>}</ul>;
}

export default async function DecisionCentre() {
  const { opps, experiments, runway, recentDecisions } = await dashboardData();
  const t = today();
  const steps = await upcomingSteps(t);
  const live = opps.filter((o) => ACTIVE_STAGES.includes(o.stage) || o.stage === "hold");
  const counts = { PASS: 0, INVESTIGATE: 0, FAIL: 0, UNSCORED: 0 } as Record<string, number>;
  for (const o of opps) counts[o.decision] = (counts[o.decision] ?? 0) + 1;

  const awaiting = opps.filter((o) => o.decision === "UNSCORED" && o.stage !== "archive" && o.stage !== "reject");
  const newIdeas = awaiting.filter((o) => o.legacyRank === null);
  const scored = opps.filter((o) => o.weightedTotal !== null && o.stage !== "archive" && o.stage !== "reject")
    .sort((a, b) => (b.weightedTotal! - a.weightedTotal!) || (Number(b.evidenceConfidence) - Number(a.evidenceConfidence)));
  const legacyTop = opps.filter((o) => o.legacyRank !== null).sort((a, b) => a.legacyRank! - b.legacyRank!).slice(0, 5);

  const overdueReview = live.filter((o) => o.nextReviewDate && isoDay(o.nextReviewDate)! < t);
  const dueSoon = live.filter((o) => o.nextReviewDate && isoDay(o.nextReviewDate)! >= t)
    .sort((a, b) => isoDay(a.nextReviewDate)!.localeCompare(isoDay(b.nextReviewDate)!)).slice(0, 6);
  const readyForTest = opps.filter((o) => o.decision === "PASS" && EARLY_STAGES.includes(o.stage));
  const shouldReject = opps.filter((o) => o.decision === "FAIL" && !["reject", "archive"].includes(o.stage));
  const needsEvidence = opps.filter((o) => o.decision === "INVESTIGATE" && !["reject", "archive"].includes(o.stage));
  const stale = opps.filter((o) => o.scoreStale);
  const lowEvidence = scored.filter((o) => Number(o.evidenceConfidence) < 0.45);
  const ventures = opps.filter((o) => DEV_STAGES.includes(o.stage));

  const activeExperiments = experiments.filter((e) => !["completed", "cancelled", "abandoned", "done"].includes(String(e.status).toLowerCase()));
  const overdueExperiments = activeExperiments.filter((e) => e.endDate && isoDay(e.endDate)! < t);
  const verifiedRevenue = opps.reduce((s, o) => s + Number(o.verifiedRevenueAud ?? 0), 0);
  const testSpend = opps.reduce((s, o) => s + Number(o.actualTestSpendAud ?? 0), 0) + experiments.reduce((s, e) => s + Number(e.actualSpendAud ?? 0), 0);
  const modelled = opps.filter((o) => o.baseOwnerEarningsY2 !== null && !["reject", "archive"].includes(o.stage));
  const plannedTestBudget = experiments.filter((e) => activeExperiments.includes(e)).reduce((s, e) => s + Number(e.budgetAud ?? 0), 0);

  const runwayMonths = runway.savingsAud && runway.monthlyPersonalSpendAud ? runway.savingsAud / runway.monthlyPersonalSpendAud : null;
  const monthsToResign = Math.max(0, (new Date(runway.resignationDate).getTime() - new Date(t).getTime()) / (30.44 * 86400000));
  const runwayEnd = runwayMonths !== null ? new Date(new Date(runway.resignationDate).getTime() + runwayMonths * 30.44 * 86400000) : null;

  return (
    <>
      <PageHeader
        title="Decision Centre"
        subtitle={`${opps.length} opportunities · ${date(t)}`}
        actions={<Link href="/opportunities/new" className={btnPrimary}>+ Submit idea</Link>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="PASS" value={<span className="text-pass">{counts.PASS}</span>} hint="Ready for a commercial test" href="/opportunities?decision=PASS" />
        <Stat label="INVESTIGATE" value={<span className="text-inv">{counts.INVESTIGATE}</span>} hint="Promising, needs evidence" href="/opportunities?decision=INVESTIGATE" />
        <Stat label="FAIL" value={<span className="text-fail">{counts.FAIL}</span>} hint="Blocker or below 60" href="/opportunities?decision=FAIL" />
        <Stat label="Awaiting evaluation" value={awaiting.length} hint={`${newIdeas.length} new · ${awaiting.length - newIdeas.length} imported`} href="/opportunities?decision=UNSCORED" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Verified revenue" value={money(verifiedRevenue)} hint={`Test spend to date ${money(testSpend)}`} />
        <Stat label="Modelled owner earnings (yr 2, base)" value={modelled.length ? money(modelled.reduce((s, o) => s + o.baseOwnerEarningsY2!, 0)) : "—"}
          hint={modelled.length ? `Hypothetical · ${modelled.length} model${modelled.length > 1 ? "s" : ""}` : "No financial models yet"} />
        <Stat label="Active experiments" value={activeExperiments.length} hint={`${overdueExperiments.length} overdue · ${money(plannedTestBudget)} budgeted`} />
        <Stat label="Runway" value={runwayMonths !== null ? `${num(runwayMonths)} mo` : "Not set"}
          hint={runwayMonths !== null ? `Resign ${date(runway.resignationDate)} → to ${date(runwayEnd)}` : `${num(monthsToResign)} months to resignation · set in Settings`} href="/settings" />
      </div>

      {steps.length > 0 && (
        <Card title="Coming up in your plans" className="mt-6">
          <PlanSteps steps={steps.slice(0, 8)} today={t} showIdea />
        </Card>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Needs attention now">
          {overdueReview.length + overdueExperiments.length + readyForTest.length + stale.length === 0 ? (
            <p className="text-sm text-muted">Nothing overdue.</p>
          ) : (
            <div className="space-y-4">
              {readyForTest.length > 0 && <div><h3 className="text-xs font-semibold uppercase text-pass">Ready for a commercial test</h3><List items={readyForTest} empty="" render={(o) => `score ${num(o.weightedTotal)}`} /></div>}
              {overdueReview.length > 0 && <div><h3 className="text-xs font-semibold uppercase text-fail">Review overdue ({overdueReview.length})</h3><List items={overdueReview} empty="" render={(o) => `was due ${date(o.nextReviewDate)}`} /></div>}
              {overdueExperiments.length > 0 && (
                <div><h3 className="text-xs font-semibold uppercase text-fail">Experiments past end date</h3>
                  <ul className="divide-y divide-line">{overdueExperiments.map((e) => <li key={e.id} className="py-2 text-sm">{e.code} · {e.oppName ?? "Unlinked"} · ended {date(e.endDate)}</li>)}</ul>
                </div>
              )}
              {stale.length > 0 && <p className="text-sm text-inv">{stale.length} score(s) use an older weighting. <Link className="underline" href="/settings">Rescore</Link>.</p>}
            </div>
          )}
        </Card>

        <Card title="Top ranked" action={<Link href="/compare" className="text-xs font-medium text-accent">Compare →</Link>}>
          {scored.length > 0 ? (
            <List items={scored} empty="" render={(o) => `${num(o.weightedTotal)} / 100 · evidence ${pct(o.evidenceConfidence)}`} />
          ) : (
            <>
              <p className="mb-2 text-sm text-muted">Nothing scored under the AVI model yet. Original provisional ranking (subjective, not validated):</p>
              <List items={legacyTop} empty="No opportunities yet." render={(o) => `original #${o.legacyRank} · ${o.legacyScore}/100`} />
            </>
          )}
        </Card>

        <Card title="Should be rejected">
          <List items={shouldReject} empty="No FAIL decisions waiting to be closed out." render={(o) => (o.weightedTotal !== null ? `score ${num(o.weightedTotal)}` : "")} />
        </Card>

        <Card title="Needs further evidence">
          <List items={needsEvidence} empty="No INVESTIGATE decisions yet." render={(o) => `evidence ${pct(o.evidenceConfidence)}`} />
          {lowEvidence.length > 0 && <p className="mt-3 text-xs text-inv">{lowEvidence.length} scored opportunit{lowEvidence.length > 1 ? "ies rest" : "y rests"} mainly on estimates or assumptions.</p>}
        </Card>

        <Card title="Upcoming reviews">
          <List items={dueSoon} empty="No review dates set." render={(o) => `review ${date(o.nextReviewDate)}`} />
        </Card>

        <Card title="Ventures in development">
          {ventures.length ? <List items={ventures} empty="" render={(o) => <><StageBadge stage={o.stage} /> {money(Number(o.verifiedRevenueAud))} verified</>} /> : <p className="text-sm text-muted">None in Build, Launch or Scale yet.</p>}
        </Card>
      </div>

      <Card title="Portfolio risk" className="mt-4">
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          <li>Opportunities with no verified demand: <b>{opps.filter((o) => o.decision !== "PASS").length}</b> of {opps.length}</li>
          <li>Scored on mostly weak evidence: <b>{lowEvidence.length}</b></li>
          <li>Active pipeline without a next action: <b>{live.filter((o) => !o.nextAction).length}</b></li>
          <li>Planned test budget vs runway: <b>{money(plannedTestBudget)}</b>{runway.savingsAud ? ` (${pct(plannedTestBudget / runway.savingsAud)} of savings)` : ""}</li>
        </ul>
      </Card>

      <Card title="Recent decisions" className="mt-4">
        {recentDecisions.length === 0 ? <p className="text-sm text-muted">No decisions recorded yet.</p> : (
          <ul className="divide-y divide-line text-sm">
            {recentDecisions.map((d) => (
              <li key={d.id} className="py-2">
                <span className="text-muted">{date(d.decidedOn)} · {d.code ?? "Portfolio"}</span>{" "}
                {d.oldDecision ? `${d.oldDecision} → ` : ""}<b>{d.newDecision}</b>
                {d.reason && <div className="text-xs text-muted line-clamp-2">{d.reason}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

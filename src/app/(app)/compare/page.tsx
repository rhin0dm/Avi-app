import Link from "next/link";
import { compareData, listOpportunities } from "@/lib/repo";
import { CRITERIA, GATES } from "@/lib/scoring";
import { DecisionBadge, Hypothetical, PageHeader } from "@/components/ui";
import { money, num, pct } from "@/lib/format";
import { Picker } from "./Picker";

export const metadata = { title: "Compare" };

const TIER: Record<string, number> = { PASS: 3, INVESTIGATE: 2, UNSCORED: 1, FAIL: 0 };
type Row = Awaited<ReturnType<typeof compareData>>[number];

const crit = (r: Row, key: string) => r.criteria.find((c) => c.key === key)?.score ?? null;
const gate = (r: Row, key: string) => {
  const g = r.gates.find((x) => x.key === key);
  if (!g) return "Unknown";
  return g.status === "blocker" ? "BLOCKER" : g.status === "satisfied" ? `OK (${g.evidence.replace("_", " ")})` : "Unknown";
};
/** Evidence-adjusted score: a high score on weak evidence counts for less. Never ranks by revenue alone. */
const adjusted = (r: Row) => (r.weightedTotal === null ? null : r.weightedTotal * (0.5 + 0.5 * (r.evidenceConfidence ?? 0)));

export default async function Compare({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const ids = ((await searchParams).ids ?? "").split(",").filter(Boolean);
  const rows = await compareData(ids);
  const all = (await listOpportunities()).map((o) => ({ id: o.id, code: o.code, name: o.name, decision: o.decision }));

  const ranked = [...rows].sort((a, b) => (TIER[b.decision] - TIER[a.decision]) || ((adjusted(b) ?? -1) - (adjusted(a) ?? -1)) || ((a.peakCash ?? 1e12) - (b.peakCash ?? 1e12)));

  const best = (f: (r: Row) => number | null, high = true) => {
    const vals = rows.map(f).filter((v): v is number => v !== null);
    if (vals.length < 2) return null;
    return high ? Math.max(...vals) : Math.min(...vals);
  };
  const notes = (r: Row) => {
    const plus: string[] = [], minus: string[] = [];
    const checks: [string, (x: Row) => number | null, boolean][] = [
      ["highest earnings score", (x) => crit(x, "earnings"), true], ["strongest demand evidence", (x) => crit(x, "demand"), true],
      ["fastest route to revenue", (x) => crit(x, "acquisition"), true], ["lowest operational burden", (x) => crit(x, "operational_burden"), true],
      ["best evidence confidence", (x) => x.evidenceConfidence, true], ["lowest cash requirement", (x) => x.peakCash, false],
    ];
    for (const [label, f, high] of checks) { const b = best(f, high); if (b !== null && f(r) === b) plus.push(label); }
    if (r.decision === "UNSCORED") minus.push("not scored under the AVI model — rank is provisional");
    if (r.gates.some((g) => g.status === "blocker")) minus.push("has a critical blocker");
    if ((r.evidenceConfidence ?? 0) < 0.45 && r.weightedTotal !== null) minus.push("score rests mainly on estimates or assumptions");
    if (!r.ownerEarningsY2) minus.push("no financial model");
    else if (r.ownerEarningsY2.conservative < 0) minus.push("loses money in the conservative case");
    return { plus, minus };
  };

  const ROWS: [string, (r: Row) => React.ReactNode][] = [
    ["Decision", (r) => <DecisionBadge decision={r.decision} />],
    ["Commercial score", (r) => (r.weightedTotal !== null ? `${num(r.weightedTotal, 2)}/100` : "—")],
    ["Evidence confidence", (r) => pct(r.evidenceConfidence)],
    ["Evidence-adjusted score", (r) => num(adjusted(r), 1)],
    ["Owner earnings yr 2 (cons / base / opt)", (r) => (r.ownerEarningsY2 ? `${money(r.ownerEarningsY2.conservative)} / ${money(r.ownerEarningsY2.base)} / ${money(r.ownerEarningsY2.optimistic)}` : "No model")],
    ["Startup cost", (r) => money(r.startup)],
    ["Peak cash required (base)", (r) => money(r.peakCash)],
    ["Operating break-even (base)", (r) => (r.breakEven ? `month ${r.breakEven}` : r.ownerEarningsY2 ? "not reached" : "—")],
    ["Speed to revenue (acquisition score)", (r) => num(crit(r, "acquisition"))],
    ["Scalability (AI leverage score)", (r) => num(crit(r, "ai_leverage"))],
    ["Customer contact", (r) => r.customerContact ?? "—"],
    ["Low burden / maintenance score", (r) => num(crit(r, "operational_burden"))],
    ["Technical delivery", (r) => gate(r, "delivery")],
    ["Distribution (acquisition gate)", (r) => gate(r, "acquisition")],
    ["Regulatory risk", (r) => gate(r, "legal")],
    ["Original screening", (r) => (r.legacyRank !== null ? `#${r.legacyRank} · ${r.legacyScore}` : "—")],
  ];

  return (
    <>
      <PageHeader title="Compare opportunities" subtitle="Ranked by decision, then score adjusted for evidence strength — not by projected revenue." />
      <Picker all={all} selected={ids} />
      {rows.length >= 2 ? (
        <>
          <section className="mb-4 rounded-xl border border-line bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold">Ranked recommendation</h2>
            <ol className="space-y-3 text-sm">
              {ranked.map((r, i) => {
                const n = notes(r);
                return (
                  <li key={r.id}>
                    <div className="flex flex-wrap items-center gap-2"><b>{i + 1}.</b> <Link className="font-medium hover:text-accent" href={`/opportunities/${r.id}`}>{r.code} {r.name}</Link> <DecisionBadge decision={r.decision} /></div>
                    {n.plus.length > 0 && <div className="text-pass">+ {n.plus.join("; ")}</div>}
                    {n.minus.length > 0 && <div className="text-fail">− {n.minus.join("; ")}</div>}
                  </li>
                );
              })}
            </ol>
          </section>
          <Hypothetical>Owner earnings, startup cost and cash figures come from each opportunity&apos;s own assumptions and are not verified.</Hypothetical>
          <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-paper text-left text-xs"><tr><th className="px-3 py-2"></th>{ranked.map((r) => <th key={r.id} className="px-3 py-2"><Link href={`/opportunities/${r.id}`} className="hover:text-accent">{r.code}<div className="font-normal text-muted">{r.name}</div></Link></th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {ROWS.map(([label, f]) => <tr key={label}><td className="px-3 py-2 text-muted">{label}</td>{ranked.map((r) => <td key={r.id} className="px-3 py-2 tabular">{f(r)}</td>)}</tr>)}
                {CRITERIA.map((c) => <tr key={c.key}><td className="px-3 py-2 text-muted">{c.label}</td>{ranked.map((r) => <td key={r.id} className="px-3 py-2 tabular">{num(crit(r, c.key))}</td>)}</tr>)}
                {GATES.filter((g) => !["delivery", "acquisition", "legal"].includes(g.key)).map((g) => <tr key={g.key}><td className="px-3 py-2 text-muted">{g.label}</td>{ranked.map((r) => <td key={r.id} className="px-3 py-2">{gate(r, g.key)}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        </>
      ) : <p className="text-sm text-muted">Pick at least two opportunities.</p>}
    </>
  );
}

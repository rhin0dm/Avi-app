"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DecisionBadge, StageBadge } from "@/components/ui";
import { date, money, num, pct, STAGE_LABEL } from "@/lib/format";

export type RegisterRow = {
  id: string; code: string; name: string; stage: string; decision: string; track: string | null;
  weightedTotal: number | null; evidenceConfidence: number | null; legacyRank: number | null; legacyScore: number | null;
  baseOwnerEarningsY2: number | null; nextReviewDate: string | null; customerContact: string | null; merged: boolean; stale: boolean;
};

const SORTS = {
  score: { label: "AVI score", fn: (a: RegisterRow, b: RegisterRow) => (b.weightedTotal ?? -1) - (a.weightedTotal ?? -1) },
  evidence: { label: "Evidence confidence", fn: (a: RegisterRow, b: RegisterRow) => (b.evidenceConfidence ?? -1) - (a.evidenceConfidence ?? -1) },
  legacy: { label: "Original rank", fn: (a: RegisterRow, b: RegisterRow) => (a.legacyRank ?? 9999) - (b.legacyRank ?? 9999) },
  earnings: { label: "Modelled earnings (hypothetical)", fn: (a: RegisterRow, b: RegisterRow) => (b.baseOwnerEarningsY2 ?? -Infinity) - (a.baseOwnerEarningsY2 ?? -Infinity) },
  review: { label: "Next review", fn: (a: RegisterRow, b: RegisterRow) => (a.nextReviewDate ?? "9999").localeCompare(b.nextReviewDate ?? "9999") },
  code: { label: "Code", fn: (a: RegisterRow, b: RegisterRow) => a.code.localeCompare(b.code) },
} as const;

export function RegisterTable({ rows, initialDecision }: { rows: RegisterRow[]; initialDecision: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [decision, setDecision] = useState(initialDecision);
  const [stage, setStage] = useState("");
  const [track, setTrack] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [sort, setSort] = useState<keyof typeof SORTS>("legacy");
  const [picked, setPicked] = useState<string[]>([]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => showClosed || (!r.merged && r.stage !== "archive" && r.stage !== "reject"))
      .filter((r) => !decision || r.decision === decision)
      .filter((r) => !stage || r.stage === stage)
      .filter((r) => !track || r.track === track)
      .filter((r) => !needle || `${r.code} ${r.name}`.toLowerCase().includes(needle))
      .sort(SORTS[sort].fn);
  }, [rows, q, decision, stage, track, showClosed, sort]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-6)));

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-6">
        <input className="col-span-2" placeholder="Search name or code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select value={decision} onChange={(e) => setDecision(e.target.value)} aria-label="Decision">
          <option value="">All decisions</option><option>PASS</option><option>INVESTIGATE</option><option>FAIL</option><option value="UNSCORED">Not scored</option>
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
          <option value="">All stages</option>{Object.entries(STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={track} onChange={(e) => setTrack(e.target.value)} aria-label="Track">
          <option value="">All tracks</option><option value="cash">Cash</option><option value="balanced">Balanced</option><option value="growth">Growth</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as keyof typeof SORTS)} aria-label="Sort">
          {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>Sort: {v.label}</option>)}
        </select>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <label className="!m-0 flex items-center gap-2 !text-sm !font-normal"><input type="checkbox" className="!w-auto" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show rejected, archived and merged</label>
        <span className="text-muted">{visible.length} shown</span>
      </div>
      {picked.length > 0 && (
        <div className="sticky top-14 z-10 mb-3 flex items-center justify-between rounded-lg bg-accent px-4 py-2 text-sm text-white">
          <span>{picked.length} selected</span>
          <div className="flex gap-3">
            <button onClick={() => setPicked([])} className="opacity-80">Clear</button>
            <button disabled={picked.length < 2} onClick={() => router.push(`/compare?ids=${picked.join(",")}`)} className="font-semibold disabled:opacity-50">Compare →</button>
          </div>
        </div>
      )}

      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden">
        {visible.map((r) => (
          <li key={r.id} className="flex gap-3 rounded-xl border border-line bg-white p-3">
            <input type="checkbox" className="mt-1 !w-5 h-5 shrink-0" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} />
            <Link href={`/opportunities/${r.id}`} className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium leading-snug">{r.name}</div>
                <DecisionBadge decision={r.decision} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span>{r.code}</span><StageBadge stage={r.stage} />
                {r.weightedTotal !== null && <span>Score {num(r.weightedTotal)} · ev {pct(r.evidenceConfidence)}</span>}
                {r.legacyRank !== null && <span>Orig #{r.legacyRank} ({r.legacyScore})</span>}
                {r.merged && <span>merged</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border border-line bg-white md:block">
        <table className="w-full text-sm">
          <thead className="bg-paper text-left text-xs text-muted">
            <tr>
              <th className="w-8 px-3 py-2"></th><th className="px-3 py-2">Opportunity</th><th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Decision</th><th className="px-3 py-2 text-right">AVI score</th><th className="px-3 py-2 text-right">Evidence</th>
              <th className="px-3 py-2 text-right" title="Original subjective screening">Original</th>
              <th className="px-3 py-2 text-right" title="Base scenario, year 2, hypothetical">Model yr 2</th><th className="px-3 py-2">Review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visible.map((r) => (
              <tr key={r.id} className="hover:bg-paper/60">
                <td className="px-3 py-2"><input type="checkbox" className="!w-4" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} /></td>
                <td className="px-3 py-2">
                  <Link href={`/opportunities/${r.id}`} className="font-medium hover:text-accent">{r.name}</Link>
                  <div className="text-xs text-muted">{r.code}{r.track ? ` · ${r.track}` : ""}{r.customerContact ? ` · contact: ${r.customerContact}` : ""}{r.merged ? " · merged" : ""}</div>
                </td>
                <td className="px-3 py-2"><StageBadge stage={r.stage} /></td>
                <td className="px-3 py-2"><DecisionBadge decision={r.decision} />{r.stale && <span className="ml-1 text-xs text-inv" title="Scored under older weights">•</span>}</td>
                <td className="px-3 py-2 text-right tabular">{num(r.weightedTotal)}</td>
                <td className="px-3 py-2 text-right tabular">{pct(r.evidenceConfidence)}</td>
                <td className="px-3 py-2 text-right tabular text-muted">{r.legacyRank !== null ? `#${r.legacyRank} · ${r.legacyScore}` : "—"}</td>
                <td className="px-3 py-2 text-right tabular">{money(r.baseOwnerEarningsY2)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-muted">{date(r.nextReviewDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <p className="p-6 text-center text-sm text-muted">No opportunities match.</p>}
      </div>
    </div>
  );
}

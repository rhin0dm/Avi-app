"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CRITERIA, EVIDENCE_LEVELS, GATES, scoreOpportunity, type CriterionScore, type GateAssessment, type Thresholds, type Weights } from "@/lib/scoring";
import { DecisionBadge, btnPrimary } from "@/components/ui";
import { api } from "@/lib/client";
import { num, pct } from "@/lib/format";

export function ScoreEditor({ id, initial, weights, thresholds, versionLabel }: {
  id: string; initial: { criteria: CriterionScore[]; gates: GateAssessment[] }; weights: Weights; thresholds: Thresholds; versionLabel: string;
}) {
  const router = useRouter();
  const [criteria, setCriteria] = useState<CriterionScore[]>(CRITERIA.map((c) => initial.criteria.find((x) => x.key === c.key) ?? { key: c.key, score: null, evidence: "unsupported", rationale: "" }));
  const [gates, setGates] = useState<GateAssessment[]>(GATES.map((g) => initial.gates.find((x) => x.key === g.key) ?? { key: g.key, status: "unknown", evidence: "unsupported", note: "" }));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => {
    try { return scoreOpportunity(criteria, gates, weights, thresholds); } catch { return null; }
  }, [criteria, gates, weights, thresholds]);

  const setC = (i: number, p: Partial<CriterionScore>) => setCriteria((cs) => cs.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const setG = (i: number, p: Partial<GateAssessment>) => setGates((gs) => gs.map((g, j) => (j === i ? { ...g, ...p } : g)));

  async function save() {
    setBusy(true);
    const r = await api(`/api/opportunities/${id}/score`, "POST", { criteria, gates });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "Score saved and decision recorded" } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Scoring model: <b>{versionLabel}</b>. Score each criterion 0–10 (higher is better — for burden and risk, 10 means low burden / low risk). Tag the evidence behind each score honestly: the arithmetic is fixed, the evidence tag decides whether PASS is allowed.</p>

      <section className="rounded-xl border border-line bg-white">
        <h3 className="border-b border-line px-4 py-3 text-sm font-semibold">Criteria</h3>
        <ul className="divide-y divide-line">
          {CRITERIA.map((c, i) => (
            <li key={c.key} className="grid gap-2 p-4 sm:grid-cols-[1fr_7rem_12rem]">
              <div>
                <div className="text-sm font-medium">{c.label} <span className="text-muted">· {weights[c.key]}%</span></div>
                <div className="text-xs text-muted">{c.help}</div>
                <textarea className="mt-2" rows={1} placeholder="Why this score? Cite the evidence." value={criteria[i].rationale ?? ""} onChange={(e) => setC(i, { rationale: e.target.value })} aria-label={`${c.label} rationale`} />
              </div>
              <div>
                <label htmlFor={`s-${c.key}`}>Score 0–10</label>
                <input id={`s-${c.key}`} type="number" min={0} max={10} step={0.1} inputMode="decimal" value={criteria[i].score ?? ""}
                  onChange={(e) => setC(i, { score: e.target.value === "" ? null : Math.min(10, Math.max(0, Math.round(Number(e.target.value) * 10) / 10)) })} />
              </div>
              <div>
                <label htmlFor={`e-${c.key}`}>Evidence</label>
                <select id={`e-${c.key}`} value={criteria[i].evidence} onChange={(e) => setC(i, { evidence: e.target.value as CriterionScore["evidence"] })}>
                  {EVIDENCE_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-line bg-white">
        <h3 className="border-b border-line px-4 py-3 text-sm font-semibold">Critical gates <span className="font-normal text-muted">— a blocker forces FAIL; PASS needs every gate satisfied on verified or credible evidence</span></h3>
        <ul className="divide-y divide-line">
          {GATES.map((g, i) => (
            <li key={g.key} className="grid gap-2 p-4 sm:grid-cols-[1fr_9rem_12rem]">
              <div>
                <div className="text-sm font-medium">{g.label}</div>
                <input className="mt-2" placeholder="Note / evidence" value={gates[i].note ?? ""} onChange={(e) => setG(i, { note: e.target.value })} aria-label={`${g.label} note`} />
              </div>
              <div>
                <label htmlFor={`g-${g.key}`}>Status</label>
                <select id={`g-${g.key}`} value={gates[i].status} onChange={(e) => setG(i, { status: e.target.value as GateAssessment["status"] })}>
                  <option value="unknown">Unknown</option><option value="satisfied">Satisfied</option><option value="blocker">Blocker</option>
                </select>
              </div>
              <div>
                <label htmlFor={`ge-${g.key}`}>Evidence</label>
                <select id={`ge-${g.key}`} value={gates[i].evidence} onChange={(e) => setG(i, { evidence: e.target.value as GateAssessment["evidence"] })}>
                  {EVIDENCE_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {preview && (
        <section className="sticky bottom-3 rounded-xl border border-line bg-white p-4 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <DecisionBadge decision={preview.decision} size="lg" />
              <span className="tabular text-sm">{preview.weightedTotal !== null ? <><b>{num(preview.weightedTotal, 2)}</b>/100</> : "incomplete"} · evidence {pct(preview.evidenceConfidence)} ({preview.evidenceLabel})</span>
            </div>
            <button className={btnPrimary} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save score"}</button>
          </div>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-muted">Breakdown</summary>
            <table className="mt-2 w-full text-xs tabular">
              <tbody>{preview.contributions.map((c) => <tr key={c.key}><td className="py-0.5">{c.label}</td><td className="text-right">{c.score ?? "—"} × {c.weight}%</td><td className="w-16 text-right font-semibold">{c.points !== null ? num(c.points, 2) : "—"}</td></tr>)}</tbody>
            </table>
            <ul className="mt-2 list-disc pl-5 text-xs">{preview.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </details>
          {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-pass" : "text-fail"}`}>{msg.text}</p>}
        </section>
      )}
    </div>
  );
}

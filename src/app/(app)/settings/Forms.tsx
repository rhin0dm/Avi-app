"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CRITERIA, type Thresholds, type Weights } from "@/lib/scoring";
import { btnPrimary, btnSecondary } from "@/components/ui";
import { api } from "@/lib/client";
import type { Runway } from "@/lib/validation";

export function WeightsForm({ weights, thresholds }: { weights: Weights; thresholds: Thresholds }) {
  const router = useRouter();
  const [w, setW] = useState<Record<string, string>>(Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, String(v)])));
  const [t, setT] = useState({ pass: String(thresholds.pass), investigate: String(thresholds.investigate), ev: String(Math.round(thresholds.minEvidenceConfidence * 100)) });
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const total = Object.values(w).reduce((s, x) => s + (Number(x) || 0), 0);
  async function save() {
    const r = await api("/api/settings/scoring", "POST", {
      label: label || `Custom ${new Date().toLocaleDateString("en-AU")}`,
      weights: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Number(v)])),
      thresholds: { pass: Number(t.pass), investigate: Number(t.investigate), minEvidenceConfidence: Number(t.ev) / 100 },
    });
    setMsg(r.ok ? { ok: true, text: "New scoring version is active. Existing scores keep their old version until you rescore." } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  }
  return (
    <div className="space-y-3 text-sm">
      {CRITERIA.map((c) => (
        <div key={c.key} className="grid grid-cols-[1fr_5rem] items-center gap-2">
          <span>{c.label}</span>
          <input inputMode="numeric" aria-label={`${c.label} weight`} value={w[c.key]} onChange={(e) => setW((p) => ({ ...p, [c.key]: e.target.value }))} />
        </div>
      ))}
      <p className={total === 100 ? "text-muted" : "text-fail"}>Total {total}% {total !== 100 && "— must be 100"}</p>
      <div className="grid grid-cols-3 gap-2">
        <div><label htmlFor="tp">PASS ≥</label><input id="tp" inputMode="numeric" value={t.pass} onChange={(e) => setT({ ...t, pass: e.target.value })} /></div>
        <div><label htmlFor="ti">INVESTIGATE ≥</label><input id="ti" inputMode="numeric" value={t.investigate} onChange={(e) => setT({ ...t, investigate: e.target.value })} /></div>
        <div><label htmlFor="te">Min evidence %</label><input id="te" inputMode="numeric" value={t.ev} onChange={(e) => setT({ ...t, ev: e.target.value })} /></div>
      </div>
      <div><label htmlFor="vl">Version name</label><input id="vl" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. More weight on speed" /></div>
      <button className={btnPrimary} disabled={total !== 100} onClick={save}>Save as new version</button>
      {msg && <p className={msg.ok ? "text-pass" : "text-fail"}>{msg.text}</p>}
    </div>
  );
}

export function SignOut() {
  const router = useRouter();
  return <button className={btnSecondary} onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }}>Sign out</button>;
}

export function RescoreButton({ stale }: { stale: number }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="text-sm">
      <p className="mb-2 text-muted">{stale} score(s) were calculated with older weights. Rescoring re-applies your saved criterion scores and evidence under the active weights; old versions stay in history.</p>
      <button className={btnSecondary} disabled={busy || stale === 0} onClick={async () => {
        setBusy(true);
        const r = await api<{ rescored: number }>("/api/settings/rescore");
        setBusy(false);
        setMsg(r.ok ? `Rescored ${r.data.rescored}` : r.error);
        router.refresh();
      }}>{busy ? "Rescoring…" : "Rescore all"}</button>
      {msg && <span className="ml-2">{msg}</span>}
    </div>
  );
}

export function RunwayForm({ initial }: { initial: Runway }) {
  const router = useRouter();
  const [v, setV] = useState({ savings: initial.savingsAud?.toString() ?? "", spend: initial.monthlyPersonalSpendAud?.toString() ?? "", date: initial.resignationDate, salary: initial.currentSalaryAud?.toString() ?? "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[$,\s]/g, "")));
  const months = n(v.savings) && n(v.spend) ? n(v.savings)! / n(v.spend)! : null;
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <div><label htmlFor="rs">Savings available (AUD)</label><input id="rs" inputMode="decimal" value={v.savings} onChange={(e) => setV({ ...v, savings: e.target.value })} /></div>
        <div><label htmlFor="rp">Personal spend / month</label><input id="rp" inputMode="decimal" value={v.spend} onChange={(e) => setV({ ...v, spend: e.target.value })} /></div>
        <div><label htmlFor="rd">Resignation date</label><input id="rd" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
        <div><label htmlFor="rsal">Current salary (AUD/yr)</label><input id="rsal" inputMode="decimal" value={v.salary} onChange={(e) => setV({ ...v, salary: e.target.value })} /></div>
      </div>
      <p className="text-muted">{months !== null ? `Runway ≈ ${months.toFixed(1)} months after resignation, before any business income.` : "Enter savings and monthly spend to calculate runway."}</p>
      <button className={btnPrimary} onClick={async () => {
        const r = await api("/api/settings/runway", "POST", { savingsAud: n(v.savings), monthlyPersonalSpendAud: n(v.spend), resignationDate: v.date, currentSalaryAud: n(v.salary) });
        setMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error });
        router.refresh();
      }}>Save runway</button>
      {msg && <span className={`ml-2 ${msg.ok ? "text-pass" : "text-fail"}`}>{msg.text}</span>}
      <p className="text-xs text-muted">Stored privately in your database. Used only for the runway figure on the Decision Centre.</p>
    </div>
  );
}

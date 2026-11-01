"use client";
import Link from "next/link";
import { useState } from "react";
import { btnPrimary, btnSecondary } from "@/components/ui";

type Similar = { id: string; code: string; name: string; similarity: number; exact: boolean };

export function IdeaForm({ aiConfigured }: { aiConfigured: boolean }) {
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; code: string; similar: Similar[]; interpretation: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)]));
    const res = await fetch("/api/opportunities", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) {
      setError(data.issues?.map((i: { message: string }) => i.message).join("; ") ?? data.error);
      setBusy(false);
      return;
    }
    const s = { id: data.opportunity.id, code: data.opportunity.code, similar: data.similar, interpretation: aiConfigured ? "running" : "not_configured" };
    setSaved(s);
    setBusy(false);
    if (aiConfigured) {
      const r = await fetch(`/api/opportunities/${s.id}/interpret`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      setSaved({ ...s, interpretation: d.status ?? "failed" });
    }
  }

  if (saved) {
    return (
      <div className="max-w-2xl space-y-4 rounded-xl border border-line bg-white p-5">
        <p className="font-semibold text-pass">✓ Saved as {saved.code}</p>
        {saved.similar.length > 0 && (
          <div className="rounded-lg bg-inv-soft p-3 text-sm">
            <p className="font-semibold text-inv">Possible duplicates already in AVI</p>
            <ul className="mt-1 space-y-1">
              {saved.similar.map((s) => (
                <li key={s.id}><Link className="underline" href={`/opportunities/${s.id}`}>{s.code} {s.name}</Link> <span className="text-muted">({s.exact ? "same name" : `${Math.round(s.similarity * 100)}% overlap`})</span></li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">If it is the same idea, open the new record and use Merge.</p>
          </div>
        )}
        <p className="text-sm text-muted">
          {saved.interpretation === "running" && "Interpreting the idea with AI…"}
          {saved.interpretation === "completed" && "AI interpretation is ready on the detail page (marked as inference, not evidence)."}
          {saved.interpretation === "failed" && "AI interpretation failed. The idea is saved; retry from the detail page."}
          {saved.interpretation === "not_configured" && "AI interpretation is off until an API key is configured. You can fill in the fields yourself."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/opportunities/${saved.id}`} className={btnPrimary}>Open {saved.code}</Link>
          <button className={btnSecondary} onClick={() => { setSaved(null); setMore(false); }}>Submit another</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-4 rounded-xl border border-line bg-white p-5">
      <div>
        <label htmlFor="name">Idea name</label>
        <input id="name" name="name" required minLength={3} maxLength={300} placeholder="e.g. Supplier price-increase detector" />
      </div>
      <div>
        <label htmlFor="description">Describe it (optional, any length)</label>
        <textarea id="description" name="description" rows={4} placeholder="AI software that identifies unexplained supplier price increases for Australian construction companies." />
      </div>
      <button type="button" className="text-sm font-medium text-accent" onClick={() => setMore(!more)}>{more ? "− Fewer fields" : "+ Target market, pricing, budget, evidence…"}</button>
      {more && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="targetMarket">Target market</label><input id="targetMarket" name="targetMarket" /></div>
          <div><label htmlFor="proposedPricing">Pricing idea</label><input id="proposedPricing" name="proposedPricing" placeholder="e.g. $149/month" /></div>
          <div><label htmlFor="budgetAud">Test budget (AUD)</label><input id="budgetAud" name="budgetAud" inputMode="decimal" /></div>
          <div><label htmlFor="track">Track</label><select id="track" name="track" defaultValue=""><option value="">—</option><option value="cash">Cash</option><option value="balanced">Balanced</option><option value="growth">Growth</option></select></div>
          <div className="sm:col-span-2"><label htmlFor="userEvidence">Evidence you already have</label><textarea id="userEvidence" name="userEvidence" rows={2} placeholder="Conversations, enquiries, sales — with dates and sources" /></div>
          <div className="sm:col-span-2"><label htmlFor="relevantExperience">Your relevant experience</label><textarea id="relevantExperience" name="relevantExperience" rows={2} /></div>
          <div className="sm:col-span-2"><label htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={2} /></div>
        </div>
      )}
      {error && <p className="text-sm text-fail">{error}</p>}
      <button className={btnPrimary} disabled={busy}>{busy ? "Saving…" : "Save idea"}</button>
    </form>
  );
}

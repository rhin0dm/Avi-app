"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { btnPrimary } from "@/components/ui";
import { api } from "@/lib/client";

type Fields = Record<string, string | number | null>;
const SECTIONS: { title: string; fields: [string, string, "text" | "area" | "date" | "money" | "track"][] }[] = [
  { title: "The opportunity", fields: [
    ["name", "Name", "text"], ["description", "Business concept", "area"], ["targetCustomer", "Target customer", "area"],
    ["problem", "Problem being solved", "area"], ["coreHypothesis", "Core commercial hypothesis", "area"],
    ["businessModels", "Business models", "area"], ["revenueMechanisms", "Revenue mechanisms", "area"],
    ["assumptions", "Assumptions to investigate", "area"], ["primaryRisks", "Primary risks", "area"],
  ] },
  { title: "Market and money", fields: [
    ["track", "Track", "track"], ["customerContact", "Customer contact level", "text"], ["targetMarket", "Target market", "text"],
    ["proposedPricing", "Pricing idea", "text"], ["budgetAud", "Test budget (AUD)", "money"], ["revenueAssumptions", "Revenue assumptions", "area"],
    ["competitorLeads", "Competitor / source leads", "area"], ["actualTestSpendAud", "Actual test spend (AUD)", "money"],
    ["verifiedRevenueAud", "Verified revenue (AUD)", "money"],
  ] },
  { title: "Next steps", fields: [
    ["nextAction", "Next action", "area"], ["nextReviewDate", "Next review", "date"], ["owner", "Owner", "text"],
    ["userEvidence", "Evidence you hold", "area"], ["relevantExperience", "Your relevant experience", "area"], ["notes", "Notes", "area"],
  ] },
];

export function OverviewForm({ id, initial, legacy }: { id: string; initial: Fields; legacy: { decision: string | null; validation: string | null; evidence: string | null; source: string | null; raw: Record<string, unknown> | null } }) {
  const router = useRouter();
  const [v, setV] = useState<Fields>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  async function save() {
    setBusy(true);
    const patch: Record<string, unknown> = {};
    for (const k of Object.keys(v)) if (v[k] !== initial[k]) patch[k] = v[k] === "" ? null : v[k];
    const r = await api(`/api/opportunities/${id}`, "PATCH", patch);
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  }

  return (
    <div className="space-y-4">
      {SECTIONS.map((s) => (
        <section key={s.title} className="rounded-xl border border-line bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold">{s.title}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {s.fields.map(([k, label, kind]) => {
              const val = v[k] ?? "";
              const set = (x: string) => setV((p) => ({ ...p, [k]: x }));
              return (
                <div key={k} className={kind === "area" ? "sm:col-span-2" : ""}>
                  <label htmlFor={k}>{label}</label>
                  {kind === "area" ? <textarea id={k} rows={String(val).length > 160 ? 4 : 2} value={String(val)} onChange={(e) => set(e.target.value)} />
                    : kind === "track" ? <select id={k} value={String(val)} onChange={(e) => set(e.target.value)}><option value="">—</option><option value="cash">Cash</option><option value="balanced">Balanced</option><option value="growth">Growth</option></select>
                    : <input id={k} type={kind === "date" ? "date" : "text"} inputMode={kind === "money" ? "decimal" : undefined} value={String(val)} onChange={(e) => set(e.target.value)} />}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {(legacy.source || legacy.decision) && (
        <details className="rounded-xl border border-line bg-white p-4 text-sm">
          <summary className="cursor-pointer font-semibold">Original register record (read-only)</summary>
          <p className="mt-2 text-muted">Imported from {legacy.source}. Original decision: {legacy.decision ?? "—"} · validation: {legacy.validation ?? "—"} · evidence: {legacy.evidence ?? "—"}</p>
          {legacy.raw && (
            <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-[12rem_1fr]">
              {Object.entries(legacy.raw).map(([k, x]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd>{x === null ? "—" : String(x)}</dd></div>)}
            </dl>
          )}
        </details>
      )}
      <div className="sticky bottom-3 flex items-center gap-3">
        <button className={`${btnPrimary} shadow-lg`} disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : dirty ? "Save changes" : "No changes"}</button>
        {msg && <span className={`text-sm ${msg.ok ? "text-pass" : "text-fail"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}

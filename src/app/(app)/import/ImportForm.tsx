"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { btnPrimary, btnSecondary } from "@/components/ui";
import type { ImportPlan } from "@/lib/importer";

export function ImportForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(mode: "preview" | "commit") {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose a file first");
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mode", mode);
    const res = await fetch("/api/import", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Import failed");
    if (mode === "preview") { setPlan(data.plan); setSummary(null); } else { setSummary(data.summary); setPlan(null); }
  }

  const newOpps = plan?.opportunities.filter((o) => o.status === "new") ?? [];
  const dupOpps = plan?.opportunities.filter((o) => o.status === "duplicate") ?? [];

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">Step 1 previews exactly what will happen. Nothing is written until you confirm. Re-importing the same register never creates duplicates, and original rankings are kept as a separate legacy score — they are not treated as validated.</p>
      <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={() => { setPlan(null); setSummary(null); }} />
      <button className={btnSecondary} disabled={busy} onClick={() => send("preview")}>{busy && !plan ? "Reading…" : "Preview import"}</button>
      {error && <p className="text-fail">{error}</p>}

      {plan && (
        <div className="space-y-3 rounded-lg bg-paper p-3">
          {plan.previousImportOfSameFile && <p className="text-inv">This exact file was imported on {new Date(plan.previousImportOfSameFile).toLocaleString("en-AU")}.</p>}
          <p><b>{newOpps.length}</b> new opportunities · <b>{dupOpps.length}</b> already in AVI (skipped) · <b>{plan.evidence.filter((e) => e.status === "new").length}</b> evidence items · <b>{plan.experiments.filter((e) => e.status === "new").length}</b> experiments · <b>{plan.decisions.filter((d) => d.status === "new").length}</b> decision-history rows · {plan.skippedExamples.length} example rows ignored</p>
          <p className="text-xs text-muted">Sheets used: {plan.sheetsFound.join(", ")}. Not imported: {plan.sheetsIgnored.join(", ") || "none"}.</p>
          {plan.warnings.length > 0 && <ul className="list-disc pl-5 text-inv">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {newOpps.length > 0 && (
            <details>
              <summary className="cursor-pointer font-semibold">New opportunities and missing fields</summary>
              <ul className="mt-2 divide-y divide-line">
                {newOpps.map((o) => <li key={o.key} className="py-1.5">{o.code ?? "(new code)"} · {o.name} <span className="text-muted">· original #{o.rank} · {o.legacyScore}/100</span>
                  {o.missingFields.length > 0 && <div className="text-xs text-muted">Missing: {o.missingFields.join(", ")}</div>}</li>)}
              </ul>
            </details>
          )}
          <button className={btnPrimary} disabled={busy} onClick={() => send("commit")}>{busy ? "Importing…" : `Import ${newOpps.length} opportunities`}</button>
        </div>
      )}

      {summary && (
        <div className="rounded-lg bg-pass-soft p-3 text-pass">
          <p className="font-semibold">Import complete</p>
          <p>{String(summary.opportunitiesCreated)} opportunities created, {String(summary.opportunitiesSkippedAsDuplicate)} duplicates skipped, {String(summary.evidenceCreated)} evidence items, {String(summary.evidenceLinks)} evidence links, {String(summary.experimentsCreated)} experiments.</p>
          <Link href="/opportunities" className="underline">Open the register →</Link>
        </div>
      )}
    </div>
  );
}

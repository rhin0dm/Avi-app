"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { DecisionBadge, btnPrimary, btnSecondary } from "@/components/ui";
import type { ImportPlan } from "@/lib/importer";

type Summary = {
  fileVersion: string | null; opportunitiesCreated: number; opportunitiesUpdated: number; conflictsKept: number;
  evidenceCreated: number; evidenceUpdated: number; evidenceLinks: number; experimentsCreated: number; experimentsUpdated: number;
  competitors: number; nicheScans: number; scored: string[]; briefsNeeded: { code: string; file: string }[];
};

const show = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "(empty)";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
};

export function ImportForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(mode: "preview" | "commit") {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose a file first");
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mode", mode);
    fd.append("overwrite", overwrite ? "1" : "0");
    const res = await fetch("/api/import", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Import failed");
    if (mode === "preview") { setPlan(data.plan); setSummary(null); } else { setSummary(data.summary); setPlan(null); }
  }

  const opps = plan?.opportunities ?? [];
  const newOpps = opps.filter((o) => o.status === "new");
  const updOpps = opps.filter((o) => o.status === "duplicate" && o.changes.length > 0);
  const sameOpps = opps.filter((o) => o.status === "duplicate" && o.changes.length === 0);
  const conflicts = [
    ...opps.flatMap((o) => o.conflicts.map((c) => ({ who: o.duplicateOf ?? o.name, ...c }))),
    ...(plan?.evidence ?? []).flatMap((e) => e.conflicts.map((c) => ({ who: e.code, ...c }))),
  ];
  const newScores = plan?.scores.filter((s) => s.status === "new") ?? [];
  const count = (xs: { status: string }[] | undefined, st: string) => xs?.filter((x) => x.status === st).length ?? 0;
  const evUpd = plan?.evidence.filter((e) => e.status === "duplicate" && e.changes.length > 0).length ?? 0;
  const exUpd = plan?.experiments.filter((e) => e.status === "duplicate" && e.changes.length > 0).length ?? 0;

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">Step 1 previews exactly what will happen. Nothing is written until you confirm. Importing a newer version of your register updates ideas already in AVI instead of duplicating them, and never overwrites a value you changed in AVI unless you say so.</p>
      <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={() => { setPlan(null); setSummary(null); }} />
      <button className={btnSecondary} disabled={busy} onClick={() => send("preview")}>{busy && !plan ? "Reading…" : "Preview import"}</button>
      {error && <p className="text-fail">{error}</p>}

      {plan && (
        <div className="space-y-3 rounded-lg bg-paper p-3">
          {plan.fileVersion && <p>Workbook version <b>{plan.fileVersion}</b></p>}
          {plan.previousImportOfSameFile && <p className="text-inv">This exact file was imported on {new Date(plan.previousImportOfSameFile).toLocaleString("en-AU")}.</p>}
          <ul className="space-y-0.5">
            <li>Ideas: <b>{newOpps.length}</b> new · <b>{updOpps.length}</b> updated · {sameOpps.length} unchanged</li>
            <li>Evidence: <b>{count(plan.evidence, "new")}</b> new · <b>{evUpd}</b> updated</li>
            <li>Experiments: <b>{count(plan.experiments, "new")}</b> new · <b>{exUpd}</b> updated{plan.superseded.length ? ` · ${plan.superseded.length} marked superseded` : ""}</li>
            <li>Competitors: <b>{count(plan.competitors, "new")}</b> new · {count(plan.competitors, "update")} updated · Niche backlog: <b>{count(plan.nicheScans, "new")}</b> new · {count(plan.nicheScans, "update")} updated</li>
            <li>Decision-history rows: <b>{count(plan.decisions, "new")}</b> new · Scores from Idea Evaluations: <b>{newScores.length}</b></li>
          </ul>
          <p className="text-xs text-muted">Sheets used: {plan.sheetsFound.join(", ")}. Not imported: {plan.sheetsIgnored.join(", ") || "none"}.{plan.skippedExamples.length ? ` ${plan.skippedExamples.length} example rows ignored.` : ""}</p>
          {plan.warnings.length > 0 && <ul className="list-disc pl-5 text-inv">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}

          {newScores.length > 0 && (
            <div className="rounded-md border border-line bg-white p-3">
              <p className="mb-1 font-semibold">Scores to import</p>
              <ul className="space-y-1">{newScores.map((s) => (
                <li key={s.code} className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{s.code}</span>
                  <b className="tabular">{s.aviTotal}/100</b><DecisionBadge decision={s.aviDecision} />
                  {s.workbookDecision && !s.workbookDecision.toUpperCase().startsWith(s.aviDecision) && <span className="text-xs text-inv">workbook says {s.workbookDecision}</span>}
                </li>))}</ul>
            </div>
          )}

          {updOpps.length > 0 && (
            <details>
              <summary className="cursor-pointer font-semibold">What will be updated ({updOpps.length} ideas)</summary>
              <ul className="mt-2 divide-y divide-line">
                {updOpps.map((o) => <li key={o.key} className="py-1.5"><b>{o.duplicateOf}</b> {o.name}
                  <div className="text-xs text-muted">{o.changes.map((c) => c.field === "stage" ? `Stage ${show(c.from)} → ${show(c.to)}` : c.label).join(" · ")}</div></li>)}
              </ul>
            </details>
          )}
          {newOpps.length > 0 && (
            <details>
              <summary className="cursor-pointer font-semibold">New ideas ({newOpps.length})</summary>
              <ul className="mt-2 divide-y divide-line">
                {newOpps.map((o) => <li key={o.key} className="py-1.5">{o.code ?? "(new code)"} · {o.name}
                  {o.missingFields.length > 0 && <div className="text-xs text-muted">Missing: {o.missingFields.join(", ")}</div>}</li>)}
              </ul>
            </details>
          )}
          {conflicts.length > 0 && (
            <div className="rounded-md border border-inv/30 bg-inv-soft p-3">
              <p className="font-semibold">{conflicts.length} value(s) you changed in AVI differ from the workbook</p>
              <ul className="mt-1 space-y-1 text-xs">{conflicts.map((c, i) => (
                <li key={i}><b>{c.who} · {c.label}</b><br />AVI: {show(c.from)}<br />Workbook: {show(c.to)}</li>))}</ul>
              <label className="mt-2 !flex items-start gap-2 !text-sm !font-normal !text-ink">
                <input type="checkbox" className="mt-1 !w-4" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                Use the workbook&apos;s values for these too
              </label>
            </div>
          )}
          {plan.briefsNeeded.length > 0 && (
            <p className="text-xs text-muted">The register names research briefs not yet in AVI: {plan.briefsNeeded.map((b) => b.file).join(", ")}. Import them below to add their scores and evidence.</p>
          )}
          <button className={btnPrimary} disabled={busy} onClick={() => send("commit")}>{busy ? "Importing…" : "Import"}</button>
        </div>
      )}

      {summary && (
        <div className="rounded-lg bg-pass-soft p-3 text-pass">
          <p className="font-semibold">Import complete{summary.fileVersion ? ` (${summary.fileVersion})` : ""}</p>
          <p>{summary.opportunitiesCreated} ideas added, {summary.opportunitiesUpdated} updated
            {summary.conflictsKept ? `, ${summary.conflictsKept} of your own values kept` : ""}. {summary.evidenceCreated} evidence added, {summary.evidenceUpdated} updated, {summary.evidenceLinks} links.
            {" "}{summary.experimentsCreated} experiments added, {summary.experimentsUpdated} updated. {summary.competitors} competitors, {summary.nicheScans} niche backlog items.
            {summary.scored.length ? ` Scored: ${summary.scored.join(", ")}.` : ""}</p>
          {summary.briefsNeeded.length > 0 && <p className="mt-1">Next: import the research briefs {summary.briefsNeeded.map((b) => b.code).join(", ")} below.</p>}
          <Link href="/opportunities" className="underline">Open the register →</Link>
        </div>
      )}
    </div>
  );
}

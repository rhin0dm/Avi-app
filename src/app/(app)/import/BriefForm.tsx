"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { DecisionBadge, btnPrimary, btnSecondary } from "@/components/ui";
import type { BriefPlan, DocumentPlan } from "@/lib/briefImport";
import { num } from "@/lib/format";

function ScoreLine({ label, r }: { label: string; r: BriefPlan["parentScore"] }) {
  return r ? <div className="flex flex-wrap items-center gap-2"><span>{label}:</span><b className="tabular">{num(r.result.weightedTotal, 2)}/100</b><DecisionBadge decision={r.result.decision} /><span className="text-xs text-muted">({r.label})</span></div> : null;
}

export function BriefForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<BriefPlan | null>(null);
  const [createChild, setCreateChild] = useState(true);
  const [analyst, setAnalyst] = useState("Grok research agent (per owner)");
  const [done, setDone] = useState<{ childCode: string | null; evidenceCreated: number; scored: string[] } | null>(null);
  const [doc, setDoc] = useState<DocumentPlan | null>(null);
  const [docDone, setDocDone] = useState<{ code: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(mode: "preview" | "commit") {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose a research brief (.md) first");
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mode", mode);
    fd.append("createChild", createChild ? "1" : "0");
    fd.append("analyst", analyst);
    const res = await fetch("/api/research", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Import failed");
    setPlan(null); setDone(null); setDoc(null); setDocDone(null);
    if (mode === "preview") { if (data.plan?.kind === "document") setDoc(data.plan); else setPlan(data.plan); }
    else if (data.summary?.kind === "document") setDocDone(data.summary);
    else setDone(data.summary);
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">Upload a research brief (.md) written for one idea, such as your Grok briefs, or any other Markdown file for an idea (a sample pack, a script) to keep it on that idea. AVI files the scores, evidence and recommendations against that idea, labelled with who produced them. Research evidence is stored as <i>AI-reported</i>, never as verified, and the critical gates stay open until you confirm them.</p>
      <input ref={fileRef} type="file" accept=".md,.markdown,.txt,text/markdown" onChange={() => { setPlan(null); setDone(null); setDoc(null); setDocDone(null); }} />
      <div><label htmlFor="analyst">Research produced by</label><input id="analyst" value={analyst} onChange={(e) => setAnalyst(e.target.value)} /></div>
      <button className={btnSecondary} disabled={busy} onClick={() => send("preview")}>{busy && !plan ? "Reading…" : "Preview brief"}</button>
      {error && <p className="text-fail">{error}</p>}
      {doc && (
        <div className="space-y-2 rounded-lg bg-paper p-3">
          <p>This isn&apos;t a research brief, so it will be kept as a <b>document</b> on the idea — no scores or evidence are taken from it.</p>
          <p><b>{doc.title}</b>{doc.opportunity ? <> → {doc.opportunity.code} {doc.opportunity.name}</> : null}</p>
          {doc.alreadyImported && <p className="text-inv">Already added on {new Date(doc.alreadyImported).toLocaleString("en-AU")}.</p>}
          {doc.warnings.length > 0 && <ul className="list-disc pl-5 text-inv">{doc.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <button className={btnPrimary} disabled={busy || !doc.opportunity || Boolean(doc.alreadyImported)} onClick={() => send("commit")}>{busy ? "Adding…" : "Add document"}</button>
        </div>
      )}
      {docDone && <div className="rounded-lg bg-pass-soft p-3 text-pass"><p className="font-semibold">Document added to {docDone.code}</p><p>Find it on that idea&apos;s Research tab.</p></div>}

      {plan && (
        <div className="space-y-3 rounded-lg bg-paper p-3">
          <p><b>{plan.parsed.title}</b>{plan.parsed.preparedOn ? ` · prepared ${plan.parsed.preparedOn}` : ""}</p>
          {plan.alreadyImported && <p className="text-inv">This exact brief was already imported on {new Date(plan.alreadyImported).toLocaleString("en-AU")}.</p>}
          {plan.parent ? <p>Attaches to <b>{plan.parent.code}</b> {plan.parent.name}</p> : null}
          <ScoreLine label={`${plan.parent?.code ?? ""} score`} r={plan.parentScore} />
          {plan.child && (
            <div className="rounded-md border border-line bg-white p-3">
              <label className="!m-0 flex items-start gap-2 !text-sm !font-normal !text-ink">
                <input type="checkbox" className="mt-1 !w-4" checked={createChild} onChange={(e) => setCreateChild(e.target.checked)} />
                <span>{plan.child.exists ? <>Score existing idea <b>{plan.child.exists.code}</b></> : <>Create new idea <b>{plan.child.code}</b></>} &ldquo;{plan.child.name}&rdquo;, as the brief recommends</span>
              </label>
              <div className="mt-2 pl-6"><ScoreLine label="Its score" r={plan.child.score} /></div>
            </div>
          )}
          {plan.parsed.classificationNote && <p className="text-xs text-muted">Brief&apos;s own classification: {plan.parsed.classificationNote}</p>}
          <p>{plan.evidence.filter((e) => e.status === "new").length} evidence items to add · {plan.evidence.filter((e) => e.status === "duplicate").length} already in AVI</p>
          {plan.warnings.length > 0 && <ul className="list-disc pl-5 text-inv">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <button className={btnPrimary} disabled={busy || !plan.parent || Boolean(plan.alreadyImported)} onClick={() => send("commit")}>{busy ? "Importing…" : "Import brief"}</button>
        </div>
      )}

      {done && (
        <div className="rounded-lg bg-pass-soft p-3 text-pass">
          <p className="font-semibold">Brief imported</p>
          <p>{done.evidenceCreated} evidence items added. Scored: {done.scored.join(", ") || "none"}.{done.childCode ? ` New idea ${done.childCode} created.` : ""}</p>
          <Link href="/opportunities" className="underline">Open the register →</Link>
        </div>
      )}
    </div>
  );
}

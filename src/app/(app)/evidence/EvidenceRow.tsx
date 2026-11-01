"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EVIDENCE_LEVELS } from "@/lib/scoring";
import { api } from "@/lib/client";

type E = { id: string; code: string | null; claim: string; classification: string; originalClassification: string | null; sourceUrl: string | null;
  scope: string | null; limitations: string | null; relevantTo: string | null; actionRequired: string | null; links: { id: string; code: string }[] };

export function EvidenceRow({ e, options }: { e: E; options: { id: string; code: string; name: string }[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const post = async (body: unknown) => {
    const r = await api(`/api/evidence/${e.id}`, "POST", body);
    setErr(r.ok ? null : r.error);
    if (r.ok) router.refresh();
  };
  const linkedIds = new Set(e.links.map((l) => l.id));
  return (
    <li className="min-w-0 overflow-hidden rounded-xl border border-line bg-white p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1"><span className="mr-2 font-mono text-xs">{e.code}</span>{e.claim}</div>
        <select className="!w-auto max-w-full !py-1 !text-xs" value={e.classification} onChange={(x) => post({ action: "classify", classification: x.target.value })} aria-label="Classification">
          {EVIDENCE_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.key === "unsupported" ? "Unverified / unsupported" : l.label}</option>)}
        </select>
      </div>
      <div className="mt-1 break-all text-xs text-muted">
        {e.sourceUrl ? <a className="underline" href={e.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{e.sourceUrl}</a> : "No source URL"}
        {e.scope && ` · ${e.scope}`}{e.limitations && ` · ${e.limitations}`}
      </div>
      {e.originalClassification && <div className="text-xs text-muted">Imported as: {e.originalClassification}</div>}
      {e.relevantTo && <div className="text-xs text-muted">Register says relevant to: <i>{e.relevantTo}</i></div>}
      {e.actionRequired && <div className="text-xs">To do: {e.actionRequired}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {e.links.map((l) => (
          <span key={l.id} className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-xs text-accent">
            <Link href={`/opportunities/${l.id}`}>{l.code}</Link>
            <button aria-label={`Unlink ${l.code}`} onClick={() => post({ action: "unlink", opportunityId: l.id })}>×</button>
          </span>
        ))}
        <select className="!w-auto max-w-full !py-1 !text-xs" value="" onChange={(x) => x.target.value && post({ action: "link", opportunityId: x.target.value })} aria-label="Link to opportunity">
          <option value="">+ Link to…</option>
          {options.filter((o) => !linkedIds.has(o.id)).map((o) => <option key={o.id} value={o.id}>{o.code} {o.name}</option>)}
        </select>
      </div>
      {err && <p className="mt-1 text-xs text-fail">{err}</p>}
    </li>
  );
}

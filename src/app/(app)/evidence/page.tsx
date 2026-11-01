import { listEvidence, listNicheScans, listOpportunities } from "@/lib/repo";
import { PageHeader } from "@/components/ui";
import { EvidenceRow } from "./EvidenceRow";

export const metadata = { title: "Evidence" };

export default async function EvidenceLibrary() {
  const items = await listEvidence();
  const opps = await listOpportunities();
  const scans = await listNicheScans();
  const options = opps.map((o) => ({ id: o.id, code: o.code, name: o.name }));
  return (
    <>
      <PageHeader title="Evidence library" subtitle="Every source, its classification and the opportunities it supports. Reclassify only after you have checked the source yourself." />
      {items.length === 0 ? <p className="text-sm text-muted">No evidence yet. Import your register or wait for Phase 2 research.</p> : (
        <ul className="space-y-2">
          {items.map((e) => <EvidenceRow key={e.id} e={JSON.parse(JSON.stringify(e))} options={options} />)}
        </ul>
      )}
      {scans.length > 0 && (
        <details className="mt-6 rounded-xl border border-line bg-white p-4 text-sm">
          <summary className="cursor-pointer"><b>Niche scan backlog ({scans.length})</b>
            <div className="text-xs text-muted">Niches spotted during research but not promoted to ideas, from the workbook&apos;s Niche scan backlog sheet.</div>
          </summary>
          <ul className="mt-3 divide-y divide-line">
            {scans.map((n) => (
              <li key={n.id} className="py-2">
                <div className="flex flex-wrap gap-2"><span className="font-mono text-xs">{n.scanId}</span><b>{n.niche}</b></div>
                {n.whyInteresting && <div className="text-xs">{n.whyInteresting}</div>}
                <div className="break-words text-xs text-muted">{[n.promoted, n.source, n.observedOn].filter(Boolean).join(" · ")}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

import { date, money } from "@/lib/format";

const CLASS_LABEL: Record<string, string> = {
  verified: "Verified", credible_secondary: "Credible secondary", inference: "Inference", estimate: "Estimate", unsupported: "Unverified",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function EvidencePanel({ evidence, experiments }: { evidence: any[]; experiments: any[] }) {
  return (
    <div className="space-y-4 text-sm">
      <section className="rounded-xl border border-line bg-white p-4">
        <h3 className="mb-1 font-semibold">Linked evidence</h3>
        <p className="mb-3 text-xs text-muted">Live research with citations arrives in Phase 2. Imported items stay &ldquo;Unverified&rdquo; until you verify them.</p>
        {evidence.length === 0 ? <p className="text-muted">No evidence linked.</p> : (
          <ul className="divide-y divide-line">
            {evidence.map((e) => (
              <li key={e.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{e.code}</span>
                  <span className="rounded bg-paper px-1.5 py-0.5 text-xs">{CLASS_LABEL[e.classification] ?? e.classification}</span></div>
                <div className="mt-1">{e.claim}</div>
                <div className="text-xs text-muted">
                  {e.sourceUrl ? <a className="underline" href={e.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{new URL(e.sourceUrl).hostname}</a> : "No source URL"}
                  {e.scope ? ` · ${e.scope}` : ""}{e.limitations ? ` · ${e.limitations}` : ""}
                </div>
                {e.originalClassification && <div className="text-xs text-muted">Original classification: {e.originalClassification}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-xl border border-line bg-white p-4">
        <h3 className="mb-3 font-semibold">Validation experiments</h3>
        {experiments.length === 0 ? <p className="text-muted">None yet. Experiment management arrives in Phase 3.</p> : (
          <ul className="divide-y divide-line">
            {experiments.map((x) => (
              <li key={x.id} className="py-2">
                <div className="flex flex-wrap justify-between gap-2"><b>{x.code}</b><span className="capitalize text-muted">{x.status}</span></div>
                <div>{x.hypothesis}</div>
                <div className="text-xs text-muted">{x.design} · success: {x.successMetric} ≥ {x.successThreshold} · budget {money(Number(x.budgetAud))}
                  {x.startDate ? ` · ${date(x.startDate)}–${date(x.endDate)}` : ""}</div>
                {x.lessons && <div className="text-xs">Next: {x.lessons}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

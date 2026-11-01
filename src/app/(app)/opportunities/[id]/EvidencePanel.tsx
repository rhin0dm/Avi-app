import { date, host, money } from "@/lib/format";

const CLASS_LABEL: Record<string, string> = {
  verified: "Verified", credible_secondary: "Credible secondary", inference: "Inference", estimate: "Estimate", unsupported: "Unverified",
};
const DETAIL_LABEL: Record<string, string> = {
  buyer: "Buyer", offer: "Offer", channel: "Channel", budgetCeilingAud: "Budget ceiling (AUD)", stopLoss: "Stop if",
  customerTouchScore: "Customer-touch score", passThreshold: "Pass threshold",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function EvidencePanel({ evidence, experiments }: { evidence: any[]; experiments: any[] }) {
  return (
    <div className="space-y-4 text-sm">
      <section className="rounded-xl border border-line bg-white p-4">
        <h3 className="mb-1 font-semibold">Linked evidence</h3>
        <p className="mb-3 text-xs text-muted">Imported and AI-researched items are never treated as verified. Reclassify one only after you have checked the source yourself.</p>
        {evidence.length === 0 ? <p className="text-muted">No evidence linked.</p> : (
          <ul className="divide-y divide-line">
            {evidence.map((e) => (
              <li key={e.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{e.code}</span>
                  <span className="rounded bg-paper px-1.5 py-0.5 text-xs">{CLASS_LABEL[e.classification] ?? e.classification}</span></div>
                <div className="mt-1">{e.claim}</div>
                <div className="break-words text-xs text-muted">
                  {e.sourceUrl && host(e.sourceUrl) ? <a className="underline" href={e.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{host(e.sourceUrl)}</a> : "No source URL"}
                  {e.scope ? ` · ${e.scope}` : ""}{e.limitations ? ` · ${e.limitations}` : ""}
                </div>
                {e.originalClassification && <div className="text-xs text-muted">Original classification: {e.originalClassification}</div>}
                {e.sourceNote && <div className="text-xs text-inv">{e.sourceNote}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-xl border border-line bg-white p-4">
        <h3 className="mb-3 font-semibold">Validation experiments</h3>
        {experiments.length === 0 ? <p className="text-muted">None yet.</p> : (
          <ul className="divide-y divide-line">
            {experiments.map((x) => (
              <li key={x.id} className="py-2">
                <div className="flex flex-wrap justify-between gap-2"><b>{x.code}</b><span className="capitalize text-muted">{x.status}</span></div>
                <div>{x.hypothesis}</div>
                <div className="break-words text-xs text-muted">{x.design}</div>
                <div className="text-xs text-muted">
                  {x.successThreshold ? `Success: ${x.successThreshold}` : ""}{x.budgetAud !== null ? ` · budget ${money(Number(x.budgetAud))}` : ""}
                  {x.startDate ? ` · ${date(x.startDate)}–${date(x.endDate)}` : ""}
                </div>
                {x.details && (
                  <dl className="mt-1 grid gap-x-3 text-xs sm:grid-cols-[auto_1fr]">
                    {Object.entries(x.details as Record<string, string | number>).filter(([k]) => DETAIL_LABEL[k]).map(([k, v]) => (
                      <div key={k} className="contents"><dt className="font-semibold text-muted">{DETAIL_LABEL[k]}</dt><dd className="mb-1 break-words">{String(v)}</dd></div>
                    ))}
                  </dl>
                )}
                {x.lessons && <div className="text-xs">Notes: {x.lessons}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

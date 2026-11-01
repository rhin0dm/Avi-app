import { listEvidence, listOpportunities } from "@/lib/repo";
import { PageHeader } from "@/components/ui";
import { EvidenceRow } from "./EvidenceRow";

export const metadata = { title: "Evidence" };

export default async function EvidenceLibrary() {
  const [items, opps] = await Promise.all([listEvidence(), listOpportunities()]);
  const options = opps.map((o) => ({ id: o.id, code: o.code, name: o.name }));
  return (
    <>
      <PageHeader title="Evidence library" subtitle="Every source, its classification and the opportunities it supports. Reclassify only after you have checked the source yourself." />
      {items.length === 0 ? <p className="text-sm text-muted">No evidence yet. Import your register or wait for Phase 2 research.</p> : (
        <ul className="space-y-2">
          {items.map((e) => <EvidenceRow key={e.id} e={JSON.parse(JSON.stringify(e))} options={options} />)}
        </ul>
      )}
    </>
  );
}

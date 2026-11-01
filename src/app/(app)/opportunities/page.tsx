import Link from "next/link";
import { listOpportunities } from "@/lib/repo";
import { PageHeader, btnPrimary, btnSecondary } from "@/components/ui";
import { RegisterTable, type RegisterRow } from "./RegisterTable";
import { isoDay } from "@/lib/format";

export const metadata = { title: "Opportunity register" };

export default async function Register({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const rows: RegisterRow[] = (await listOpportunities({ includeMerged: true })).map((o) => ({
    id: o.id, code: o.code, name: o.name, stage: o.stage, decision: o.decision, track: o.track ?? null,
    weightedTotal: o.weightedTotal === null ? null : Number(o.weightedTotal),
    evidenceConfidence: o.evidenceConfidence === null ? null : Number(o.evidenceConfidence),
    legacyRank: o.legacyRank, legacyScore: o.legacyScore === null ? null : Number(o.legacyScore),
    baseOwnerEarningsY2: o.baseOwnerEarningsY2, nextReviewDate: isoDay(o.nextReviewDate),
    customerContact: o.customerContact ?? null, merged: Boolean(o.mergedIntoId), stale: Boolean(o.scoreStale),
  }));
  return (
    <>
      <PageHeader title="Opportunity register" subtitle="Every idea, with its current decision. Tap a row for detail."
        actions={<><Link href="/api/export?format=xlsx" className={btnSecondary}>Export</Link><Link href="/opportunities/new" className={btnPrimary}>+ Submit idea</Link></>} />
      <RegisterTable rows={rows} initialDecision={sp.decision ?? ""} />
    </>
  );
}

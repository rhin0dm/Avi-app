import { getSql, ready } from "@/lib/db";
import { PageHeader, Card, btnSecondary } from "@/components/ui";
import { ImportForm } from "./ImportForm";
import { BriefForm } from "./BriefForm";

export const metadata = { title: "Import / export" };

export default async function ImportPage() {
  await ready();
  const runs = await getSql()`select * from import_runs order by at desc limit 10`;
  return (
    <>
      <PageHeader title="Import and export" />
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-4">
          <Card title="Import your Opportunity Register (.xlsx)">
            <ImportForm />
          </Card>
          <Card title="Import a research brief (.md)">
            <BriefForm />
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Export">
            <div className="flex flex-col gap-2">
              <a className={btnSecondary} href="/api/export?format=xlsx">Excel workbook (all data, 8 sheets)</a>
              <a className={btnSecondary} href="/api/export?format=csv">CSV (opportunity register)</a>
              <a className={btnSecondary} href="/api/export?format=json">Full JSON backup</a>
            </div>
            <p className="mt-2 text-xs text-muted">Keep the JSON backup somewhere safe — it contains every table, including history and audit log.</p>
          </Card>
          <Card title="Previous imports">
            {runs.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
              <ul className="divide-y divide-line text-sm">
                {runs.map((r) => (
                  <li key={r.id} className="py-2">{r.filename} · {new Date(r.at).toLocaleString("en-AU")}
                    <div className="text-xs text-muted">{r.summary.opportunitiesCreated} created · {r.summary.opportunitiesSkippedAsDuplicate} duplicates skipped · {r.summary.evidenceCreated} evidence · {r.summary.experimentsCreated} experiments</div></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

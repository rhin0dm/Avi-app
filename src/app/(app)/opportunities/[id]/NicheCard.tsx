import Link from "next/link";
import { NICHE_FIELDS } from "@/lib/niche";

type Rel = { id: string; code: string; name: string };

/** The niche identity fields from the workbook (v1.3+), plus parent / child ideas. */
export function NicheCard({ niche, parent, narrower, briefFile }: { niche: Record<string, string | number> | null; parent: Rel | null; narrower: Rel[]; briefFile: string | null }) {
  const rows = NICHE_FIELDS.filter(([k]) => niche?.[k] !== undefined && niche?.[k] !== null && String(niche[k]).trim() !== "");
  if (!rows.length && !parent && !narrower.length) return null;
  return (
    <section className="mb-4 rounded-xl border border-line bg-white p-4 text-sm">
      <h3 className="mb-2 font-semibold">Niche profile</h3>
      {parent && <p className="mb-2">Child of <Link className="underline" href={`/opportunities/${parent.id}`}>{parent.code} {parent.name}</Link></p>}
      {narrower.length > 0 && <p className="mb-2">Narrower ideas: {narrower.map((c) => <Link key={c.id} className="mr-2 underline" href={`/opportunities/${c.id}`}>{c.code} {c.name}</Link>)}</p>}
      {rows.length > 0 && (
        <dl className="grid gap-x-4 sm:grid-cols-[minmax(9rem,auto)_1fr]">
          {rows.map(([k, label]) => (
            <div key={k} className="contents"><dt className="text-xs font-semibold text-muted sm:pt-0.5">{label}</dt><dd className="mb-2 break-words">{String(niche![k])}</dd></div>
          ))}
        </dl>
      )}
      {briefFile && <p className="text-xs text-muted">Research brief named in the workbook: {briefFile.split("/").pop()}</p>}
    </section>
  );
}

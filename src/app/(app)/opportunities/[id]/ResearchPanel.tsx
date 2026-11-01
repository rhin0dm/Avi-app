import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { date, host } from "@/lib/format";

type Competitor = { id: string; name: string; altType: string | null; price: string | null; coverage: string | null;
  switchingFriction: string | null; gap: string | null; sourceText: string | null; sourceUrl: string | null; checkedOn: string | null };
type Brief = { id: string; title: string; version: string | null; analyst: string | null; preparedOn: Date | string | null; content: string; importedAt: Date | string };

/** Renders imported research briefs. Raw HTML in the Markdown is never rendered. */
export function ResearchPanel({ briefs, competitors }: { briefs: Brief[]; competitors: Competitor[] }) {
  return (
    <div className="space-y-4">
      {competitors.length > 0 && (
        <details open={briefs.length === 0} className="rounded-xl border border-line bg-white p-4">
          <summary className="cursor-pointer text-sm"><b>Competitors &amp; alternatives ({competitors.length})</b>
            <div className="text-xs text-muted">From the workbook&apos;s Competitor &amp; Alternatives sheet. Prices are as dated by the researcher — re-check before relying on them.</div>
          </summary>
          <ul className="mt-3 divide-y divide-line text-sm">
            {competitors.map((c) => (
              <li key={c.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2"><b>{c.name}</b>
                  {c.altType && <span className="rounded bg-paper px-1.5 py-0.5 text-xs">{c.altType}</span>}
                  {c.coverage && <span className="text-xs text-muted">covers our wedge: {c.coverage}</span>}</div>
                {c.price && <div className="break-words text-xs">Price: {c.price}</div>}
                {c.gap && <div className="break-words text-xs text-muted">Gap: {c.gap}</div>}
                <div className="break-words text-xs text-muted">
                  {c.sourceUrl && host(c.sourceUrl) ? <a className="underline" href={c.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{host(c.sourceUrl)}</a> : c.sourceText}
                  {c.checkedOn ? ` · checked ${c.checkedOn}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      {briefs.length === 0 && <p className="text-sm text-muted">No research briefs yet. Upload one on <b>Import / export</b>, under &ldquo;Import a research brief&rdquo;.</p>}
      {briefs.map((b, i) => (
        <details key={b.id} open={i === 0} className="rounded-xl border border-line bg-white p-4">
          <summary className="cursor-pointer text-sm">
            <b>{b.title}</b>
            <div className="text-xs text-muted">By {b.analyst ?? "unknown"} · prepared {date(b.preparedOn)} · imported {date(b.importedAt)}. AI research: check sources before relying on them.</div>
          </summary>
          <div className="brief mt-4 overflow-x-auto text-sm">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              skipHtml
              components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline">{children}</a> }}
            >
              {b.content}
            </ReactMarkdown>
          </div>
        </details>
      ))}
    </div>
  );
}

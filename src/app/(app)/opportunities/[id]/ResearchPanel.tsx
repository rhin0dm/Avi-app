import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { date } from "@/lib/format";

type Brief = { id: string; title: string; version: string | null; analyst: string | null; preparedOn: Date | string | null; content: string; importedAt: Date | string };

/** Renders imported research briefs. Raw HTML in the Markdown is never rendered. */
export function ResearchPanel({ briefs }: { briefs: Brief[] }) {
  if (briefs.length === 0) {
    return <p className="text-sm text-muted">No research briefs yet. Upload one on <b>Import / export</b>, under &ldquo;Import a research brief&rdquo;.</p>;
  }
  return (
    <div className="space-y-4">
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

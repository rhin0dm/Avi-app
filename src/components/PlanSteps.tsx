import Link from "next/link";
import type { PlanStep } from "@/lib/docPlan";

type Step = PlanStep & { oppId: string; code: string; docTitle: string };

/** Dated steps read from a plan document. Today's steps are highlighted. */
export function PlanSteps({ steps, today, showIdea = false }: { steps: Step[]; today: string; showIdea?: boolean }) {
  return (
    <ul className="divide-y divide-line px-4 text-sm">
      {steps.map((s, i) => {
        const now = s.start <= today && s.end >= today;
        return (
          <li key={i} className={`py-2 ${now ? "-mx-4 bg-accent-soft px-4" : ""}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <b className={now ? "text-accent" : "text-ink"}>{now ? "Today · " : ""}{s.dateText}</b>
              {showIdea && <Link className="underline" href={`/opportunities/${s.oppId}`}>{s.code}</Link>}
              {s.section && <span className="truncate">{s.section}</span>}
            </div>
            <div className="break-words">{s.action}</div>
            {s.doneWhen && <div className="text-xs text-muted">Done when: {s.doneWhen}</div>}
          </li>
        );
      })}
    </ul>
  );
}

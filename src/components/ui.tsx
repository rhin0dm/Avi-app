import Link from "next/link";
import type { ReactNode } from "react";
import { STAGE_LABEL } from "@/lib/format";

const DECISION_STYLE: Record<string, string> = {
  PASS: "bg-pass-soft text-pass ring-pass/30",
  INVESTIGATE: "bg-inv-soft text-inv ring-inv/30",
  FAIL: "bg-fail-soft text-fail ring-fail/30",
  UNSCORED: "bg-white text-muted ring-line",
};
const DECISION_ICON: Record<string, string> = { PASS: "✓", INVESTIGATE: "?", FAIL: "✕", UNSCORED: "–" };

export function DecisionBadge({ decision, size = "sm" }: { decision: string; size?: "sm" | "lg" }) {
  const d = decision in DECISION_STYLE ? decision : "UNSCORED";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold ring-1 ring-inset whitespace-nowrap ${DECISION_STYLE[d]} ${size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs"}`}>
      <span aria-hidden>{DECISION_ICON[d]}</span>
      {d === "UNSCORED" ? "Not scored" : d}
    </span>
  );
}

export function StageBadge({ stage }: { stage: string }) {
  return <span className="inline-flex rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent whitespace-nowrap">{STAGE_LABEL[stage] ?? stage}</span>;
}

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-white ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <div className="rounded-xl border border-line bg-white p-4 h-full transition hover:border-accent/40">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Hypothetical({ children = "Hypothetical projection from your assumptions — not verified earnings." }: { children?: ReactNode }) {
  return <p className="rounded-md bg-inv-soft px-3 py-2 text-xs text-inv">{children}</p>;
}

export const btn = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition disabled:opacity-50";
export const btnPrimary = `${btn} bg-accent text-white hover:bg-accent/90`;
export const btnSecondary = `${btn} border border-line bg-white hover:border-accent/50`;
export const btnDanger = `${btn} border border-fail/30 bg-white text-fail hover:bg-fail-soft`;

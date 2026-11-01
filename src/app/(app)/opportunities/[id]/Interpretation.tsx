"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { btnSecondary } from "@/components/ui";
import { api } from "@/lib/client";

type Data = { summary: string; targetCustomer: string; problem: string; businessModels: string[]; revenueMechanisms: string[];
  assumptionsToInvestigate: string[]; keyRisks: string[]; clarifyingQuestions: string[]; provider: string; model: string; generatedAt: string } | null;

function L({ t, xs }: { t: string; xs: string[] }) {
  return xs.length ? <div><div className="text-xs font-semibold text-muted">{t}</div><ul className="list-disc pl-5">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null;
}

export function Interpretation({ id, status, data, aiConfigured }: { id: string; status: string; data: Data; aiConfigured: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setBusy(true); setMsg(null);
    const r = await api<{ status: string; error?: string }>(`/api/opportunities/${id}/interpret`);
    setBusy(false);
    if (!r.ok) setMsg(r.error); else if (r.data.status !== "completed") setMsg(r.data.error ?? `Status: ${r.data.status}`);
    router.refresh();
  }
  async function apply() {
    const r = await api<{ applied: string[] }>(`/api/opportunities/${id}/apply-interpretation`);
    setMsg(r.ok ? (r.data.applied.length ? `Filled: ${r.data.applied.join(", ")}` : "All those fields already have your text — nothing overwritten.") : r.error);
    router.refresh();
  }
  if (!data) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-line bg-white p-3 text-sm">
        <span className="text-muted">
          {status === "failed" ? "AI interpretation failed." : aiConfigured ? "No AI interpretation yet." : "AI interpretation is off (no API key configured)."}
        </span>
        {aiConfigured && <button className={btnSecondary} disabled={busy} onClick={run}>{busy ? "Interpreting…" : status === "failed" ? "Retry interpretation" : "Interpret with AI"}</button>}
        {msg && <p className="w-full text-fail">{msg}</p>}
      </div>
    );
  }
  return (
    <details className="mb-4 rounded-xl border border-line bg-white p-4 text-sm">
      <summary className="cursor-pointer font-semibold">AI interpretation <span className="font-normal text-muted">— inference only, not evidence · {data.model}</span></summary>
      <div className="mt-3 space-y-3">
        <p>{data.summary}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><div className="text-xs font-semibold text-muted">Likely customer</div>{data.targetCustomer}</div>
          <div><div className="text-xs font-semibold text-muted">Problem</div>{data.problem}</div>
          <L t="Possible business models" xs={data.businessModels} />
          <L t="Revenue mechanisms" xs={data.revenueMechanisms} />
          <L t="Assumptions to investigate" xs={data.assumptionsToInvestigate} />
          <L t="Key risks" xs={data.keyRisks} />
          <L t="Questions to answer" xs={data.clarifyingQuestions} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={btnSecondary} onClick={apply}>Copy into empty fields</button>
          <button className={btnSecondary} disabled={busy} onClick={run}>{busy ? "Interpreting…" : "Re-run"}</button>
        </div>
        {msg && <p className="text-muted">{msg}</p>}
      </div>
    </details>
  );
}

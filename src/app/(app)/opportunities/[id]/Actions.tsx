"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { STAGES } from "@/lib/validation";
import { STAGE_LABEL } from "@/lib/format";
import { btnDanger, btnPrimary, btnSecondary } from "@/components/ui";
import { api } from "@/lib/client";

export function Actions({ id, stage, merged, others }: { id: string; stage: string; merged: boolean; others: { id: string; code: string; name: string }[] }) {
  const router = useRouter();
  const [newStage, setNewStage] = useState(stage);
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState("");
  const [mergeReason, setMergeReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(url: string, body: unknown, done: string) {
    const r = await api(url, "POST", body);
    setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: r.error });
    if (r.ok) { setReason(""); setMergeReason(""); router.refresh(); }
  }
  const closed = merged || stage === "archive" || stage === "reject";

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-line bg-white p-4">
        <h3 className="mb-1 text-sm font-semibold">Move stage</h3>
        <p className="mb-3 text-xs text-muted">Idea → Research → Investigate → Validation → Build → Launch → Scale, or Hold / Reject / Archive. Every move is recorded with your reason.</p>
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
          <div><label htmlFor="st">Stage</label><select id="st" value={newStage} onChange={(e) => setNewStage(e.target.value)}>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select></div>
          <div><label htmlFor="sr">Reason</label><input id="sr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What evidence or decision prompted this?" /></div>
          <button className={btnPrimary} disabled={newStage === stage || reason.trim().length < 3} onClick={() => run(`/api/opportunities/${id}/stage`, { stage: newStage, reason }, "Stage updated")}>Move</button>
        </div>
      </section>

      {!merged && (
        <section className="rounded-xl border border-line bg-white p-4">
          <h3 className="mb-1 text-sm font-semibold">Merge into another opportunity</h3>
          <p className="mb-3 text-xs text-muted">This record is archived and linked to the target. Nothing is deleted; you can reopen it later.</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div><label htmlFor="mt">Merge into</label><select id="mt" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose…</option>{others.map((o) => <option key={o.id} value={o.id}>{o.code} {o.name}</option>)}</select></div>
            <div><label htmlFor="mr">Reason</label><input id="mr" value={mergeReason} onChange={(e) => setMergeReason(e.target.value)} placeholder="e.g. same idea, narrower" /></div>
            <button className={btnDanger} disabled={!target || mergeReason.trim().length < 3} onClick={() => run(`/api/opportunities/${id}/merge`, { targetId: target, reason: mergeReason }, "Merged")}>Merge</button>
          </div>
        </section>
      )}

      {closed && (
        <section className="rounded-xl border border-line bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold">Reopen</h3>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div><label htmlFor="rr">Reason</label><input id="rr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What changed?" /></div>
            <button className={btnSecondary} disabled={reason.trim().length < 3} onClick={() => run(`/api/opportunities/${id}/reopen`, { reason }, "Reopened")}>Reopen</button>
          </div>
        </section>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-pass" : "text-fail"}`}>{msg.text}</p>}
    </div>
  );
}

import { activeScoringVersion, getRunway, listScoringVersions } from "@/lib/repo";
import { providerStatus } from "@/lib/ai/providers";
import { Card, PageHeader } from "@/components/ui";
import { CRITERIA } from "@/lib/scoring";
import { date } from "@/lib/format";
import { WeightsForm, RunwayForm, RescoreButton, SignOut } from "./Forms";
import { getSql } from "@/lib/db";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const [active, versions, runway] = await Promise.all([activeScoringVersion(), listScoringVersions(), getRunway()]);
  const ai = providerStatus();
  const [{ n: stale }] = await getSql()`select count(*)::int as n from scores where is_current and decision <> 'LEGACY' and scoring_version_id <> ${active.id}`;
  return (
    <>
      <PageHeader title="Settings" actions={<SignOut />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Scoring weights" action={<span className="text-xs text-muted">Active: {active.label}</span>}>
          <WeightsForm weights={active.weights} thresholds={active.thresholds} />
          <div className="mt-4 border-t border-line pt-3"><RescoreButton stale={stale} /></div>
        </Card>
        <Card title="Financial runway">
          <RunwayForm initial={runway} />
        </Card>
        <Card title="Scoring version history">
          <ul className="divide-y divide-line text-sm">
            {versions.map((v) => (
              <li key={v.id} className="py-2">
                <b>{v.label}</b> {v.isActive && <span className="text-pass">· active</span>} {v.isLegacy && <span className="text-muted">· legacy (import only)</span>}
                <div className="text-xs text-muted">{date(v.createdAt)} · {Object.entries(v.weights).map(([k, w]) => `${CRITERIA.find((c) => c.key === k)?.label.split(" ")[0] ?? k.replace(/_/g, " ")} ${w}%`).join(", ")}</div>
                {v.notes && <div className="text-xs text-muted">{v.notes}</div>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="AI provider">
          {ai.configured ? <p className="text-sm">Connected: <b>{ai.provider}</b> · model <code>{ai.model}</code></p> : (
            <p className="text-sm text-muted">Not configured. Set <code>ANTHROPIC_API_KEY</code> (or <code>OPENAI_API_KEY</code> + <code>AI_MODEL</code>) in the server environment. Keys are never sent to the browser.</p>
          )}
          <p className="mt-2 text-xs text-muted">Phase 1 uses AI only to interpret new ideas. Scores and financials are always calculated by fixed code.</p>
        </Card>
      </div>
    </>
  );
}

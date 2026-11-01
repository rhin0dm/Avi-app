// Imports an AVI Master Opportunity Register workbook.
// Principles: never invent evidence, keep every original column (import_raw),
// keep the original score as a legacy version, and never duplicate on re-import.
import { readXlsx, type SheetData } from "./xlsxReader";
import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { normalizeName } from "./similarity";
import { audit, nextCode } from "./repo";
import type { Stage } from "./validation";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;

type Rec = Record<string, string | number | null>;

function readSheet(ws: SheetData, headerMatch: (h: string[]) => boolean): { headers: string[]; rows: (Rec & { __row: number })[] } | null {
  for (let hr = 0; hr < Math.min(10, ws.rows.length); hr++) {
    const headers = (ws.rows[hr] ?? []).map((h) => String(h ?? "").trim());
    if (!headerMatch(headers.map((h) => h.toLowerCase()))) continue;
    const rows: (Rec & { __row: number })[] = [];
    for (let r = hr + 1; r < Math.min(ws.rows.length, hr + 1 + MAX_ROWS); r++) {
      const row = ws.rows[r] ?? [];
      const rec: Rec & { __row: number } = { __row: r + 1 };
      let any = false;
      headers.forEach((h, i) => {
        if (!h) return;
        const v = row[i] ?? null;
        rec[h] = v;
        if (v !== null) any = true;
      });
      if (any) rows.push(rec);
    }
    return { headers: headers.filter(Boolean), rows };
  }
  return null;
}

/** Find a value by trying header aliases (case-insensitive, punctuation-insensitive). */
function pick(rec: Rec, ...aliases: string[]): string | number | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = aliases.map(norm);
  for (const [k, v] of Object.entries(rec)) if (want.includes(norm(k))) return v;
  return null;
}
const str = (v: string | number | null) => (v === null ? null : String(v));
const num = (v: string | number | null) => {
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const isoDate = (v: string | number | null) => {
  const s = str(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  return null;
};
const isExample = (rec: Rec) => Object.values(rec).some((v) => typeof v === "string" && /example only|illustrative row|^example:|replace example/i.test(v));

const STAGE_FROM_LEGACY: Record<string, Stage> = {
  investigate: "investigate", hold: "hold", backlog: "idea", pass: "investigate", fail: "reject",
  reject: "reject", archive: "archive", validation: "validation", build: "build",
};
const TRACKS = ["cash", "balanced", "growth"];

function mapEvidence(original: string | null): "verified" | "credible_secondary" | "unsupported" {
  const s = (original ?? "").toLowerCase();
  if (/not |unverified|to verify|reverif|lead|potential/.test(s)) return "unsupported";
  if (/^verified/.test(s)) return "verified";
  if (/credible secondary/.test(s)) return "credible_secondary";
  return "unsupported";
}

// Fields the register does not provide but AVI needs for a sound evaluation.
const KEY_FIELDS: [string, string][] = [
  ["targetCustomer", "Target customer"], ["problem", "Problem being solved"], ["proposedPricing", "Pricing"],
  ["revenueMechanisms", "Revenue mechanism"], ["description", "Business concept"], ["coreHypothesis", "Core hypothesis"],
];

export type ImportPlan = {
  fileSha256: string;
  sheetsFound: string[];
  sheetsIgnored: string[];
  opportunities: { key: string; row: number; code: string | null; name: string; rank: number | null; legacyScore: number | null;
    status: "new" | "duplicate"; duplicateOf?: string; missingFields: string[]; data: Record<string, unknown>; evidenceIds: string[] }[];
  evidence: { key: string; code: string; claim: string; classification: string; original: string | null; status: "new" | "duplicate"; data: Record<string, unknown> }[];
  experiments: { key: string; code: string; rank: number | null; status: "new" | "duplicate"; data: Record<string, unknown> }[];
  decisions: { key: string; status: "new" | "duplicate"; ideaId: string | null; data: Record<string, unknown> }[];
  skippedExamples: { sheet: string; row: number }[];
  warnings: string[];
  previousImportOfSameFile: string | null;
};

export function checkUpload(name: string, bytes: Uint8Array): string | null {
  if (!/\.xlsx$/i.test(name)) return "Only .xlsx workbooks are accepted.";
  if (bytes.byteLength === 0) return "The file is empty.";
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return "File is larger than 10 MB.";
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return "This is not a valid .xlsx file.";
  return null;
}

export async function planImport(sql: Sql, bytes: Uint8Array): Promise<ImportPlan> {
  let sheets: SheetData[];
  try {
    sheets = await readXlsx(bytes);
  } catch (e) {
    const why = e instanceof Error && /too large/.test(e.message) ? e.message : "Save it again from Excel as .xlsx and retry.";
    throw new Error(`The workbook could not be read. ${why}`);
  }
  const fileSha256 = createHash("sha256").update(bytes).digest("hex");
  const plan: ImportPlan = {
    fileSha256, sheetsFound: [], sheetsIgnored: [], opportunities: [], evidence: [], experiments: [], decisions: [],
    skippedExamples: [], warnings: [], previousImportOfSameFile: null,
  };
  const [prevRun] = await sql`select at from import_runs where file_sha256 = ${fileSha256} order by at desc limit 1`;
  if (prevRun) plan.previousImportOfSameFile = new Date(prevRun.at).toISOString();

  const existing = await sql`select code, normalized_name, import_key from opportunities`;
  const byName = new Map(existing.map((e) => [e.normalizedName as string, e.code as string]));
  const byKey = new Set(existing.map((e) => e.importKey).filter(Boolean));
  const evKeys = new Set((await sql`select import_key from evidence where import_key is not null`).map((e) => e.importKey));
  const exKeys = new Set((await sql`select import_key from experiments where import_key is not null`).map((e) => e.importKey));
  const dhKeys = new Set((await sql`select import_key from decision_history where import_key is not null`).map((e) => e.importKey));
  const takenCodes = new Set(existing.map((e) => e.code));

  for (const ws of sheets) {
    const title = ws.name;
    // ---- Opportunity register
    const reg = readSheet(ws, (h) => h.includes("rank") && h.some((x) => x === "opportunity" || x === "opportunity name"));
    if (reg) {
      plan.sheetsFound.push(title);
      const seen = new Set<string>();
      for (const r of reg.rows) {
        const name = str(pick(r, "Opportunity", "Opportunity name"));
        if (!name) { plan.warnings.push(`${title} row ${r.__row}: no opportunity name, skipped.`); continue; }
        if (isExample(r)) { plan.skippedExamples.push({ sheet: title, row: r.__row }); continue; }
        const nn = normalizeName(name);
        const key = `register:${nn}`;
        if (seen.has(key)) { plan.warnings.push(`${title} row ${r.__row}: "${name}" appears twice in the file; second copy skipped.`); continue; }
        seen.add(key);
        const rank = num(pick(r, "Rank"));
        const legacyDecision = str(pick(r, "Decision status", "Decision"));
        const trackRaw = (str(pick(r, "Track")) ?? "").toLowerCase();
        const data: Record<string, unknown> = {
          name, normalizedName: nn,
          description: str(pick(r, "Business concept", "Description", "Concept")),
          coreHypothesis: str(pick(r, "Core hypothesis", "Hypothesis")),
          track: TRACKS.includes(trackRaw) ? trackRaw : null,
          customerContact: str(pick(r, "Customer contact")),
          testBudgetLowAud: num(pick(r, "Test budget low AUD")),
          testBudgetHighAud: num(pick(r, "Test budget high AUD")),
          legacyEvidenceStatus: str(pick(r, "Evidence status")),
          legacyValidationStatus: str(pick(r, "Commercial validation status")),
          legacyDecision,
          legacyRank: rank,
          legacyScore: num(pick(r, "Initial score /100", "Initial score", "Score")),
          nextAction: str(pick(r, "Next action")),
          primaryRisks: str(pick(r, "Primary risks", "Risks")),
          competitorLeads: str(pick(r, "Competitor / source leads", "Competitors")),
          owner: str(pick(r, "Owner")),
          lastReviewedDate: isoDate(pick(r, "Last reviewed")),
          nextReviewDate: isoDate(pick(r, "Next review")),
          revenueAssumptions: str(pick(r, "Revenue assumptions")),
          actualTestSpendAud: num(pick(r, "Actual test spend AUD")) ?? 0,
          verifiedRevenueAud: num(pick(r, "Verified revenue AUD")) ?? 0,
          notes: str(pick(r, "Notes")),
          stage: STAGE_FROM_LEGACY[(legacyDecision ?? "").toLowerCase()] ?? "idea",
          importSource: `${title} (row ${r.__row})`,
          importKey: key,
          importRaw: Object.fromEntries(Object.entries(r).filter(([k]) => k !== "__row")),
        };
        const evidenceIds = (str(pick(r, "Evidence reference IDs", "Evidence IDs")) ?? "")
          .split(/[;,\s]+/).map((s) => s.trim()).filter(Boolean);
        const dupCode = byKey.has(key) ? existing.find((e) => e.importKey === key)?.code : byName.get(nn);
        const missingFields = KEY_FIELDS.filter(([k]) => !data[k]).map(([, label]) => label);
        let code: string | null = rank ? `AVI-${String(rank).padStart(3, "0")}` : null;
        if (code && takenCodes.has(code) && !dupCode) code = null; // allocated at commit
        if (code) takenCodes.add(code);
        plan.opportunities.push({
          key, row: r.__row, code: dupCode ?? code, name, rank, legacyScore: data.legacyScore as number | null,
          status: dupCode ? "duplicate" : "new", duplicateOf: dupCode, missingFields, data, evidenceIds,
        });
      }
      continue;
    }
    // ---- Evidence & sources
    const ev = readSheet(ws, (h) => h.includes("evidence id"));
    if (ev) {
      plan.sheetsFound.push(title);
      for (const r of ev.rows) {
        const code = str(pick(r, "Evidence ID"));
        const claim = str(pick(r, "Claim / finding", "Claim", "Finding"));
        if (!code || !claim) continue;
        const original = str(pick(r, "Evidence classification", "Classification"));
        const url = str(pick(r, "Source / verification link", "Source", "URL"));
        const key = `evidence:${code}`;
        plan.evidence.push({
          key, code, claim, classification: mapEvidence(original), original, status: evKeys.has(key) ? "duplicate" : "new",
          data: {
            code, claim, classification: mapEvidence(original), originalClassification: original,
            sourceUrl: url && /^https?:\/\//i.test(url) ? url : null,
            scope: str(pick(r, "Date / scope", "Date")), limitations: str(pick(r, "Confidence / limitations", "Limitations")),
            relevantTo: str(pick(r, "Relevant opportunities")), actionRequired: str(pick(r, "Action required")), importKey: key,
          },
        });
      }
      continue;
    }
    // ---- Experiment log
    const ex = readSheet(ws, (h) => h.includes("experiment id"));
    if (ex) {
      plan.sheetsFound.push(title);
      for (const r of ex.rows) {
        const code = str(pick(r, "Experiment ID"));
        if (!code) continue;
        if (isExample(r)) { plan.skippedExamples.push({ sheet: title, row: r.__row }); continue; }
        const key = `experiment:${code}`;
        plan.experiments.push({
          key, code, rank: num(pick(r, "Opportunity rank")), status: exKeys.has(key) ? "duplicate" : "new",
          data: {
            code, hypothesis: str(pick(r, "Hypothesis")), design: str(pick(r, "Test design")),
            successMetric: str(pick(r, "Success metric")), successThreshold: str(pick(r, "Pass threshold")),
            budgetAud: num(pick(r, "Budget AUD")), startDate: isoDate(pick(r, "Start date")), endDate: isoDate(pick(r, "End date")),
            status: (str(pick(r, "Status")) ?? "planned").toLowerCase(), actualSpendAud: num(pick(r, "Actual spend AUD")) ?? 0,
            result: str(pick(r, "Result / evidence URL")), decision: str(pick(r, "Decision")),
            lessons: str(pick(r, "Lessons / next action")), importKey: key,
          },
        });
      }
      continue;
    }
    // ---- Decision history
    const dh = readSheet(ws, (h) => h.includes("old decision") && h.includes("new decision"));
    if (dh) {
      plan.sheetsFound.push(title);
      for (const r of dh.rows) {
        const content = JSON.stringify(Object.entries(r).filter(([k]) => k !== "__row"));
        const key = `decision:${createHash("sha256").update(content).digest("hex").slice(0, 24)}`;
        const ideaId = str(pick(r, "Idea ID"));
        plan.decisions.push({
          key, ideaId, status: dhKeys.has(key) ? "duplicate" : "new",
          data: {
            decidedOn: isoDate(pick(r, "Date")) ?? new Date().toISOString().slice(0, 10),
            oldScore: str(pick(r, "Old score")), newScore: str(pick(r, "New score")),
            oldDecision: str(pick(r, "Old decision")), newDecision: str(pick(r, "New decision")),
            reason: str(pick(r, "Evidence / reason", "Reason")), source: `Workbook ${str(pick(r, "File version")) ?? ""}`.trim(),
            importKey: key,
          },
        });
      }
      continue;
    }
    // ---- Intake / evaluation / validation templates: only example rows today
    const other = readSheet(ws, (h) => h.includes("id") || h.includes("test id"));
    if (other && ["Idea Intake", "Idea Evaluations", "Validation Tests"].includes(title)) {
      const real = other.rows.filter((r) => !isExample(r) && Object.entries(r).some(([k, v]) => k !== "__row" && k !== "Weighted /100" && k !== "Decision" && v !== null));
      other.rows.filter(isExample).forEach((r) => plan.skippedExamples.push({ sheet: title, row: r.__row }));
      if (real.length) plan.warnings.push(`${title}: ${real.length} non-example row(s) found but not imported — this sheet type isn't mapped yet. Enter them through Submit idea.`);
      plan.sheetsIgnored.push(`${title} (template sheet)`);
      continue;
    }
    plan.sheetsIgnored.push(title);
  }

  // Evidence references that point nowhere
  const evCodes = new Set(plan.evidence.map((e) => e.code));
  const existingEv = new Set((await sql`select code from evidence`).map((e) => e.code));
  for (const o of plan.opportunities) {
    const missing = o.evidenceIds.filter((id) => !evCodes.has(id) && !existingEv.has(id));
    if (missing.length) plan.warnings.push(`${o.name}: references evidence ${missing.join(", ")} which is not in the file.`);
  }
  const linked = new Set(plan.opportunities.flatMap((o) => o.evidenceIds));
  const unlinked = plan.evidence.filter((e) => !linked.has(e.code));
  if (unlinked.length) {
    plan.warnings.push(`Evidence ${unlinked.map((e) => e.code).join(", ")} is not referenced by any opportunity's evidence IDs. It is imported and kept with its "relevant opportunities" text, but not linked automatically.`);
  }
  if (plan.opportunities.length === 0) plan.warnings.push("No opportunity register sheet was recognised (needs 'Rank' and 'Opportunity' columns).");
  return plan;
}

export async function commitImport(sql: Sql, plan: ImportPlan, filename: string) {
  return sql.begin(async (tx) => {
    const [legacy] = await tx`select id from scoring_versions where is_legacy order by id limit 1`;
    const created: string[] = [];
    const idByRank = new Map<number, string>();
    const idByCode = new Map<string, string>();

    for (const o of plan.opportunities) {
      if (o.status === "duplicate") {
        const [ex] = await tx`select id, legacy_rank, code from opportunities where code = ${o.duplicateOf!}`;
        if (ex?.legacyRank) idByRank.set(ex.legacyRank, ex.id);
        if (ex) idByCode.set(ex.code, ex.id);
        continue;
      }
      let code = o.code;
      if (!code || (await tx`select 1 from opportunities where code = ${code}`).length) code = await nextCode(tx);
      const data = { ...o.data, code };
      const [row] = await tx`insert into opportunities ${tx(data as Record<string, unknown>)} returning id, code`;
      created.push(row.code);
      if (o.rank) idByRank.set(o.rank, row.id);
      idByCode.set(row.code, row.id);
      if (o.legacyScore !== null && legacy) {
        await tx`insert into scores (opportunity_id, scoring_version_id, weighted_total, decision, decision_reasons, is_current)
          values (${row.id}, ${legacy.id}, ${o.legacyScore}, 'LEGACY',
          ${["Original subjective screening total from the workbook; criteria were not individually scored and it is not demand evidence."]}::jsonb, false)`;
      }
      await audit(tx, "opportunity", row.id, "imported", { file: filename, source: o.data.importSource, legacyScore: o.legacyScore });
    }

    let evidenceCreated = 0;
    for (const e of plan.evidence) {
      if (e.status === "duplicate") continue;
      await tx`insert into evidence ${tx(e.data)} on conflict (import_key) do nothing`;
      evidenceCreated++;
    }
    // Links: only explicit evidence IDs on each opportunity row
    let links = 0;
    for (const o of plan.opportunities) {
      const oppId = o.status === "duplicate" ? idByCode.get(o.duplicateOf!) : idByRank.get(o.rank ?? -1) ?? null;
      if (!oppId) continue;
      for (const code of o.evidenceIds) {
        const r = await tx`insert into opportunity_evidence (opportunity_id, evidence_id)
          select ${oppId}, id from evidence where code = ${code} on conflict do nothing returning 1`;
        links += r.length;
      }
    }

    let experimentsCreated = 0;
    for (const x of plan.experiments) {
      if (x.status === "duplicate") continue;
      const oppId = x.rank ? idByRank.get(x.rank) ?? null : null;
      await tx`insert into experiments ${tx({ ...x.data, opportunityId: oppId })} on conflict (import_key) do nothing`;
      experimentsCreated++;
    }
    let decisionsCreated = 0;
    for (const d of plan.decisions) {
      if (d.status === "duplicate") continue;
      const oppId = d.ideaId && d.ideaId !== "ALL" ? idByCode.get(d.ideaId) ?? null : null;
      await tx`insert into decision_history ${tx({ ...d.data, opportunityId: oppId })} on conflict (import_key) do nothing`;
      decisionsCreated++;
    }
    // Keep new-idea codes ahead of imported ones
    await tx`select setval('opportunity_code_seq', greatest((select coalesce(max(substring(code from 5)::int), 25)
      from opportunities where code ~ '^AVI-[0-9]+$'), 25))`;

    const summary = {
      opportunitiesCreated: created.length, opportunitiesSkippedAsDuplicate: plan.opportunities.filter((o) => o.status === "duplicate").length,
      evidenceCreated, evidenceLinks: links, experimentsCreated, decisionsCreated,
      skippedExamples: plan.skippedExamples.length, warnings: plan.warnings,
    };
    await tx`insert into import_runs (filename, file_sha256, summary) values (${filename}, ${plan.fileSha256}, ${summary as never}::jsonb)`;
    await audit(tx, "import", plan.fileSha256.slice(0, 12), "committed", summary);
    return summary;
  });
}

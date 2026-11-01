// Imports an AVI Master Opportunity Register workbook.
// Principles: never invent evidence, keep every original column (import_raw),
// keep the original score as a legacy version, and never duplicate on re-import.
import { readXlsx, type SheetData } from "./xlsxReader";
import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { findSimilar, normalizeName } from "./similarity";
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
    status: "new" | "duplicate"; duplicateOf?: string; missingFields: string[]; data: Record<string, unknown>; evidenceIds: string[];
    sourceId?: string }[];
  evidence: { key: string; code: string; claim: string; classification: string; original: string | null; status: "new" | "duplicate"; data: Record<string, unknown> }[];
  experiments: { key: string; code: string; rank: number | null; ideaId?: string | null; status: "new" | "duplicate"; data: Record<string, unknown> }[];
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
  // Rows from the intake / evaluation / validation / brief sheets, combined after all sheets are read
  const intakeRows: { title: string; r: Rec & { __row: number } }[] = [];
  const evalRows = new Map<string, Rec>();
  const briefs = new Map<string, { title: string; pairs: [string, string][] }>();

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
    // ---- Idea Intake: new ideas captured in the workbook
    const intake = readSheet(ws, (h) => h.includes("idea / niche") && h.includes("target buyer"));
    if (intake) {
      plan.sheetsFound.push(title);
      for (const r of intake.rows) {
        if (isExample(r)) { plan.skippedExamples.push({ sheet: title, row: r.__row }); continue; }
        if (str(pick(r, "Idea / niche"))) intakeRows.push({ title, r });
      }
      continue;
    }
    // ---- Idea Evaluations: merged into the matching intake idea (scores are not auto-imported)
    const evals = readSheet(ws, (h) => h.includes("weighted /100") || (h.includes("next test") && h.includes("evidence quality")));
    if (evals) {
      plan.sheetsFound.push(title);
      for (const r of evals.rows) {
        if (isExample(r)) { plan.skippedExamples.push({ sheet: title, row: r.__row }); continue; }
        const id = str(pick(r, "ID"));
        if (id) evalRows.set(id.toUpperCase(), r);
      }
      continue;
    }
    // ---- Validation Tests: become experiments linked by idea ID
    const vt = readSheet(ws, (h) => h.includes("test id") && h.includes("idea id"));
    if (vt) {
      plan.sheetsFound.push(title);
      for (const r of vt.rows) {
        const code = str(pick(r, "Test ID"));
        if (!code) continue;
        if (isExample(r)) { plan.skippedExamples.push({ sheet: title, row: r.__row }); continue; }
        const key = `experiment:${code}`;
        const result = str(pick(r, "Actual result"));
        plan.experiments.push({
          key, code, rank: null, ideaId: str(pick(r, "Idea ID"))?.toUpperCase() ?? null, status: exKeys.has(key) ? "duplicate" : "new",
          data: {
            code, hypothesis: str(pick(r, "Hypothesis")), design: str(pick(r, "14-day test", "Test design")),
            successThreshold: str(pick(r, "Success threshold")), budgetAud: num(pick(r, "Budget AUD")),
            status: !result || /not started/i.test(result) ? "planned" : result.toLowerCase().slice(0, 40),
            result: result && !/not started/i.test(result) ? result : null, decision: str(pick(r, "Decision")),
            evidenceUrl: (() => { const u = str(pick(r, "Evidence link")); return u && /^https?:\/\//i.test(u) ? u : null; })(),
            lessons: str(pick(r, "Next action")), importKey: key,
          },
        });
      }
      continue;
    }
    // ---- Brief sheets titled like "AVI-026 | ..." (label / value pairs)
    const heading = String(ws.rows[0]?.[0] ?? "");
    const briefId = heading.match(/^\s*(AVI-\d+)\s*\|/i)?.[1]?.toUpperCase();
    if (briefId) {
      plan.sheetsFound.push(title);
      const pairs: [string, string][] = [];
      for (const row of ws.rows.slice(1)) {
        const k = row?.[0], v = row?.[1];
        if (k !== null && k !== undefined && v !== null && v !== undefined && String(v).trim() !== "") pairs.push([String(k).trim(), String(v).trim()]);
      }
      briefs.set(briefId, { title, pairs });
      continue;
    }
    plan.sheetsIgnored.push(title);
  }

  // Ideas from the Idea Intake sheet, enriched with their evaluation row and brief
  const pool = existing.map((e) => ({ id: e.code as string, code: e.code as string, name: "", description: null as string | null }));
  const existingNames = await sql`select code, name from opportunities`;
  for (const p of pool) p.name = existingNames.find((x) => x.code === p.code)?.name ?? "";
  const seenIntake = new Set(plan.opportunities.map((o) => o.key));
  let scoredEvalRows = 0;
  for (const { title, r } of intakeRows) {
    const name = str(pick(r, "Idea / niche"))!;
    const sourceId = str(pick(r, "ID"))?.toUpperCase() ?? null;
    const nn = normalizeName(name);
    const key = `register:${nn}`;
    if (seenIntake.has(key)) { plan.warnings.push(`${title} row ${r.__row}: "${name}" is already in the register sheet; skipped.`); continue; }
    seenIntake.add(key);
    const ev = sourceId ? evalRows.get(sourceId) : undefined;
    const brief = sourceId ? briefs.get(sourceId) : undefined;
    const b = (label: string) => brief?.pairs.find(([k]) => k.toLowerCase() === label.toLowerCase())?.[1] ?? null;
    if (ev && ["Profit 0-10", "Demand 0-10", "Acquisition 0-10", "AI & scale 0-10", "Low burden 0-10", "Risk 0-10"].every((h) => num(pick(ev, h)) !== null)) scoredEvalRows++;
    const price = pick(r, "Proposed price AUD");
    const research = str(pick(r, "Research status"));
    const notes = [
      str(pick(r, "Source / notes")) && `Sources: ${str(pick(r, "Source / notes"))}`,
      ev && str(pick(ev, "Sources / assumptions")) && `Evaluation sources: ${str(pick(ev, "Sources / assumptions"))}`,
      ev && str(pick(ev, "Evidence quality")) && `Evaluation evidence quality: ${str(pick(ev, "Evidence quality"))}`,
      brief && `From "${brief.title}" sheet:\n` + brief.pairs.map(([k, v]) => `• ${k}: ${v}`).join("\n"),
    ].filter(Boolean).join("\n\n") || null;
    const data: Record<string, unknown> = {
      name, normalizedName: nn,
      description: b("Working model"),
      targetCustomer: str(pick(r, "Target buyer")),
      problem: str(pick(r, "Problem / trigger")),
      revenueMechanisms: str(pick(r, "Revenue model")),
      proposedPricing: typeof price === "number" ? `AUD ${price}` : str(price),
      primaryRisks: b("Critical risks"),
      legacyEvidenceStatus: str(pick(r, "Evidence level")),
      legacyDecision: research,
      owner: str(pick(r, "Owner")),
      nextAction: (ev && str(pick(ev, "Next test"))) || str(pick(r, "Next action")) || b("Next action"),
      nextReviewDate: ev ? isoDate(pick(ev, "Review date")) : null,
      testBudgetHighAud: num(b("Test budget AUD")),
      notes,
      stage: STAGE_FROM_LEGACY[(research ?? "").toLowerCase()] ?? "idea",
      importSource: `${title} (row ${r.__row})`,
      importKey: key,
      importRaw: {
        intake: Object.fromEntries(Object.entries(r).filter(([k]) => k !== "__row")),
        ...(ev ? { evaluation: ev } : {}),
        ...(brief ? { brief: Object.fromEntries(brief.pairs) } : {}),
      },
    };
    // Duplicate: same import key, same name, or an app-created idea holding this code with a similar name
    let dupCode: string | undefined = byKey.has(key) ? existing.find((e) => e.importKey === key)?.code : byName.get(nn);
    if (!dupCode && sourceId && takenCodes.has(sourceId)) {
      const holder = pool.filter((p) => p.code === sourceId);
      if (findSimilar(name, null, holder, 0.5).length) dupCode = sourceId;
    }
    const code = dupCode ?? (sourceId && /^AVI-\d+$/.test(sourceId) && !takenCodes.has(sourceId) ? sourceId : null);
    if (code) takenCodes.add(code);
    plan.opportunities.push({
      key, row: r.__row, code, name, rank: null, legacyScore: null, sourceId: sourceId ?? undefined,
      status: dupCode ? "duplicate" : "new", duplicateOf: dupCode,
      missingFields: KEY_FIELDS.filter(([k]) => !data[k]).map(([, label]) => label), data, evidenceIds: [],
    });
  }
  if (scoredEvalRows) plan.warnings.push(`${scoredEvalRows} idea(s) have scores on the Idea Evaluations sheet. Scores aren't copied automatically — re-enter them on each idea's Score tab with an evidence tag for every criterion.`);
  for (const id of evalRows.keys()) if (!intakeRows.some(({ r }) => str(pick(r, "ID"))?.toUpperCase() === id)) plan.warnings.push(`Idea Evaluations has a row for ${id} but no matching Idea Intake row; it was not imported.`);

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
    const idBySource = new Map<string, string>();

    for (const o of plan.opportunities) {
      if (o.status === "duplicate") {
        const [ex] = await tx`select id, legacy_rank, code from opportunities where code = ${o.duplicateOf!}`;
        if (ex?.legacyRank) idByRank.set(ex.legacyRank, ex.id);
        if (ex) idByCode.set(ex.code, ex.id);
        if (ex && o.sourceId) idBySource.set(o.sourceId, ex.id);
        continue;
      }
      let code = o.code;
      if (!code || (await tx`select 1 from opportunities where code = ${code}`).length) code = await nextCode(tx);
      const data = { ...o.data, code };
      const [row] = await tx`insert into opportunities ${tx(data as Record<string, unknown>)} returning id, code`;
      created.push(row.code);
      if (o.rank) idByRank.set(o.rank, row.id);
      idByCode.set(row.code, row.id);
      if (o.sourceId) idBySource.set(o.sourceId, row.id);
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
      const oppId = x.rank ? idByRank.get(x.rank) ?? null
        : x.ideaId ? idBySource.get(x.ideaId) ?? idByCode.get(x.ideaId) ?? null : null;
      await tx`insert into experiments ${tx({ ...x.data, opportunityId: oppId })} on conflict (import_key) do nothing`;
      experimentsCreated++;
    }
    let decisionsCreated = 0;
    for (const d of plan.decisions) {
      const ideaKey = d.ideaId?.toUpperCase();
      const oppId = ideaKey && ideaKey !== "ALL" ? idBySource.get(ideaKey) ?? idByCode.get(ideaKey) ?? null : null;
      if (d.status === "duplicate") {
        // An earlier import may have stored this row before its idea existed; attach it now.
        if (oppId) await tx`update decision_history set opportunity_id = ${oppId} where import_key = ${d.key} and opportunity_id is null`;
        continue;
      }
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

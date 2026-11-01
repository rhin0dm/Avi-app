// Imports an AVI Master Opportunity Register workbook (v1.1 – v1.4 layouts).
// Principles: never invent evidence, keep every original column (import_raw),
// keep the original score as a legacy version, never duplicate on re-import,
// and on re-import update only what the workbook changed — never a value the
// owner has since edited in AVI (those are reported as conflicts and kept).
import { readXlsx, type SheetData } from "./xlsxReader";
import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { findSimilar, normalizeName } from "./similarity";
import { activeScoringVersion, audit, nextCode, saveScore } from "./repo";
import { scoreOpportunity, CRITERIA, type CriterionKey } from "./scoring";
import { toAviScore } from "./researchBrief";
import type { Stage } from "./validation";
import { NICHE_FIELDS } from "./niche";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;

type Cell = string | number | null;
type Rec = Record<string, Cell>;
type Row = Rec & { __row: number };

function readSheet(ws: SheetData, headerMatch: (h: string[]) => boolean): { headers: string[]; rows: Row[] } | null {
  for (let hr = 0; hr < Math.min(10, ws.rows.length); hr++) {
    const headers = (ws.rows[hr] ?? []).map((h) => String(h ?? "").trim());
    if (!headerMatch(headers.map((h) => h.toLowerCase()))) continue;
    const rows: Row[] = [];
    for (let r = hr + 1; r < Math.min(ws.rows.length, hr + 1 + MAX_ROWS); r++) {
      const row = ws.rows[r] ?? [];
      const rec: Row = { __row: r + 1 };
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
function pick(rec: Rec, ...aliases: string[]): Cell {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = aliases.map(norm);
  for (const [k, v] of Object.entries(rec)) if (want.includes(norm(k))) return v;
  return null;
}
const str = (v: Cell | undefined) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v));
const num = (v: Cell | undefined) => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const isoDate = (v: Cell | undefined) => {
  const s = str(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  return null;
};
const rawOf = (r: Rec) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "__row"));
const isExample = (rec: Rec) => Object.values(rec).some((v) => typeof v === "string" && /example only|illustrative row|^example:|replace example/i.test(v));
const aviCode = (v: Cell | undefined) => {
  const s = str(v)?.trim().toUpperCase();
  return s && /^AVI-\d+$/.test(s) ? s : null;
};

const STAGE_FROM_LEGACY: Record<string, Stage> = {
  investigate: "investigate", hold: "hold", backlog: "idea", pass: "investigate", fail: "reject",
  reject: "reject", archive: "archive", validation: "validation", build: "build",
};
const stageFrom = (legacy: string | null): Stage => STAGE_FROM_LEGACY[(legacy ?? "").trim().toLowerCase()] ?? "idea";
const TRACKS = ["cash", "balanced", "growth"];

type EvLevel = "verified" | "credible_secondary" | "inference" | "unsupported";
function mapEvidence(original: string | null, verifiedFlag: string | null): EvLevel {
  // v1.3+: the researcher's "Verified?" column. Y means the source was checked by the researcher —
  // still secondary evidence, never direct buyer proof, so it is never "verified".
  const f = (verifiedFlag ?? "").trim().toLowerCase();
  if (f === "y" || f === "yes") return "credible_secondary";
  if (f.startsWith("partial")) return "inference";
  if (f === "n" || f === "no") return "unsupported";
  const s = (original ?? "").toLowerCase();
  if (/not |unverified|to verify|reverif|lead|potential/.test(s)) return "unsupported";
  if (/^verified/.test(s)) return "verified";
  if (/credible secondary/.test(s)) return "credible_secondary";
  return "unsupported";
}

/** "E01; E11–E23" → E01, E11, E12 … E23. */
export function expandIds(text: string | null): string[] {
  if (!text) return [];
  const out: string[] = [];
  const cleaned = text.replace(/\s*[–—-]\s*/g, "–");
  for (const tok of cleaned.split(/[;,\s]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = tok.match(/^([A-Za-z]+)(\d+)–([A-Za-z]*)(\d+)$/);
    if (m && (!m[3] || m[3].toUpperCase() === m[1].toUpperCase())) {
      const a = Number(m[2]), b = Number(m[4]);
      if (b >= a && b - a <= 500) {
        for (let i = a; i <= b; i++) out.push(`${m[1].toUpperCase()}${String(i).padStart(m[2].length, "0")}`);
        continue;
      }
    }
    out.push(tok.toUpperCase());
  }
  return [...new Set(out)];
}

function firstUrl(text: string | null): string | null {
  if (!text) return null;
  const full = text.match(/https?:\/\/[^\s;,)]+/i);
  if (full) return full[0];
  const bare = text.trim().match(/^((?:[a-z0-9-]+\.)+[a-z]{2,})(\/[^\s;,)]*)?/i);
  return bare ? `https://${bare[0]}` : null;
}

export { NICHE_FIELDS };

// Fields the register does not provide but AVI needs for a sound evaluation.
const KEY_FIELDS: [string, string][] = [
  ["targetCustomer", "Target customer"], ["problem", "Problem being solved"], ["proposedPricing", "Pricing"],
  ["revenueMechanisms", "Revenue mechanism"], ["description", "Business concept"], ["coreHypothesis", "Core hypothesis"],
];

export const FIELD_LABELS: Record<string, string> = {
  name: "Name", description: "Business concept", coreHypothesis: "Core hypothesis", track: "Track", customerContact: "Customer contact",
  testBudgetLowAud: "Test budget low", testBudgetHighAud: "Test budget high", nextAction: "Next action", primaryRisks: "Primary risks",
  competitorLeads: "Competitor leads", owner: "Owner", lastReviewedDate: "Last reviewed", nextReviewDate: "Next review",
  revenueAssumptions: "Revenue assumptions", actualTestSpendAud: "Actual test spend", verifiedRevenueAud: "Verified revenue",
  notes: "Notes", stage: "Stage", targetCustomer: "Target customer", problem: "Problem", revenueMechanisms: "Revenue model",
  proposedPricing: "Pricing", testBudgetHighAudBrief: "Test budget",
};

// Set only by imports, not editable in AVI: always refreshed from the workbook.
const WORKBOOK_OWNED = ["legacyRank", "legacyScore", "legacyDecision", "legacyEvidenceStatus", "legacyValidationStatus",
  "parentCode", "niche", "researchBriefFile", "importSource", "importRaw"];
const NOT_COMPARED = new Set([...WORKBOOK_OWNED, "normalizedName", "importKey"]);

function mapRegisterRow(r: Rec): Record<string, unknown> {
  const name = str(pick(r, "Opportunity", "Opportunity name"))!;
  const legacyDecision = str(pick(r, "Decision status", "Decision"));
  const trackRaw = (str(pick(r, "Track")) ?? "").toLowerCase();
  const niche: Record<string, string | number> = {};
  for (const [k, label] of NICHE_FIELDS) {
    const v = pick(r, label);
    if (v !== null && String(v).trim() !== "") niche[k] = v;
  }
  return {
    name, normalizedName: normalizeName(name),
    description: str(pick(r, "Business concept", "Description", "Concept")),
    coreHypothesis: str(pick(r, "Core hypothesis", "Hypothesis")),
    track: TRACKS.includes(trackRaw) ? trackRaw : null,
    customerContact: str(pick(r, "Customer contact")),
    testBudgetLowAud: num(pick(r, "Test budget low AUD")),
    testBudgetHighAud: num(pick(r, "Test budget high AUD")),
    legacyEvidenceStatus: str(pick(r, "Evidence status")),
    legacyValidationStatus: str(pick(r, "Commercial validation status")),
    legacyDecision,
    legacyRank: num(pick(r, "Rank")),
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
    stage: stageFrom(legacyDecision),
    parentCode: aviCode(pick(r, "Parent ID")),
    niche: Object.keys(niche).length ? niche : null,
    researchBriefFile: str(pick(r, "Research brief file")),
    importRaw: rawOf(r),
  };
}

type BriefPairs = { title: string; pairs: [string, string][] };
function mapIntakeRow(r: Rec, ev: Rec | undefined, brief: BriefPairs | undefined): Record<string, unknown> {
  const name = str(pick(r, "Idea / niche"))!;
  const b = (label: string) => brief?.pairs.find(([k]) => k.toLowerCase() === label.toLowerCase())?.[1] ?? null;
  const price = pick(r, "Proposed price AUD");
  const research = str(pick(r, "Research status"));
  const notes = [
    str(pick(r, "Source / notes")) && `Sources: ${str(pick(r, "Source / notes"))}`,
    ev && str(pick(ev, "Sources / assumptions")) && `Evaluation sources: ${str(pick(ev, "Sources / assumptions"))}`,
    ev && str(pick(ev, "Evidence quality")) && `Evaluation evidence quality: ${str(pick(ev, "Evidence quality"))}`,
    brief && `From "${brief.title}" sheet:\n` + brief.pairs.map(([k, v]) => `• ${k}: ${v}`).join("\n"),
  ].filter(Boolean).join("\n\n") || null;
  return {
    name, normalizedName: normalizeName(name),
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
    stage: stageFrom(research),
    importRaw: {
      intake: rawOf(r),
      ...(ev ? { evaluation: rawOf(ev) } : {}),
      ...(brief ? { brief: Object.fromEntries(brief.pairs), briefTitle: brief.title } : {}),
    },
  };
}

/** Re-create what the previous import wrote, from the raw row it stored. Null when unknown. */
function baselineFrom(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  try {
    if (o.intake && typeof o.intake === "object") {
      const brief = o.brief && typeof o.brief === "object"
        ? { title: typeof o.briefTitle === "string" ? o.briefTitle : "AI Implementation Brief", pairs: Object.entries(o.brief as Record<string, string>) }
        : undefined;
      return mapIntakeRow(o.intake as Rec, o.evaluation as Rec | undefined, brief);
    }
    if (pick(o as Rec, "Opportunity", "Opportunity name") !== null) return mapRegisterRow(o as Rec);
  } catch { /* fall through */ }
  return null;
}

/** Comparable form of a value from the workbook or the database. */
function norm(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = v.replace(/\r\n/g, "\n").trim();
    if (t === "") return null;
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
  }
  return stableJson(v);
}
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
const same = (a: unknown, b: unknown) => norm(a) === norm(b);

export type FieldChange = { field: string; label: string; from: unknown; to: unknown };

/** Three-way merge: workbook value replaces the AVI value only if AVI still holds what the last import wrote. */
function mergeFields(current: Record<string, unknown>, incoming: Record<string, unknown>, baseline: Record<string, unknown> | null) {
  const changes: FieldChange[] = [];
  const conflicts: FieldChange[] = [];
  for (const [field, to] of Object.entries(incoming)) {
    if (NOT_COMPARED.has(field)) continue;
    const cur = current[field];
    if (same(cur, to)) continue;
    const label = FIELD_LABELS[field] ?? field;
    const untouched = baseline ? same(cur, baseline[field]) : norm(cur) === null || (norm(cur) === 0 && /Aud$/.test(field));
    (untouched ? changes : conflicts).push({ field, label, from: cur ?? null, to });
  }
  return { changes, conflicts };
}

type OppPlan = {
  key: string; row: number; code: string | null; name: string; rank: number | null; legacyScore: number | null;
  status: "new" | "duplicate"; duplicateOf?: string; missingFields: string[]; data: Record<string, unknown>; evidenceIds: string[];
  sourceId?: string; changes: FieldChange[]; conflicts: FieldChange[]; refresh: boolean;
};
type EvPlan = {
  key: string; code: string; claim: string; classification: string; original: string | null;
  status: "new" | "duplicate"; data: Record<string, unknown>; linkCodes: string[];
  changes: FieldChange[]; conflicts: FieldChange[];
};
type ExpPlan = {
  key: string; code: string; rank: number | null; ideaId?: string | null; status: "new" | "duplicate";
  data: Record<string, unknown>; changes: FieldChange[];
};
type ScorePlan = {
  code: string; name: string; scores: Partial<Record<CriterionKey, number>>; confidence: "Verified" | "Partial" | "Unverified" | null;
  blocker: string | null; workbookDecision: string | null; workbookTotal: number | null;
  aviTotal: number | null; aviDecision: string; status: "new" | "same";
};

export type ImportPlan = {
  fileSha256: string;
  fileVersion: string | null;
  sheetsFound: string[];
  sheetsIgnored: string[];
  opportunities: OppPlan[];
  evidence: EvPlan[];
  experiments: ExpPlan[];
  superseded: { code: string; by: string }[];
  decisions: { key: string; status: "new" | "duplicate"; ideaId: string | null; data: Record<string, unknown> }[];
  competitors: { key: string; status: "new" | "update" | "unchanged"; data: Record<string, unknown> }[];
  nicheScans: { key: string; status: "new" | "update" | "unchanged"; data: Record<string, unknown> }[];
  scores: ScorePlan[];
  briefsNeeded: { code: string; file: string }[];
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

const EVAL_COLS: [CriterionKey, string][] = [
  ["earnings", "Profit 0-10"], ["demand", "Demand 0-10"], ["acquisition", "Acquisition 0-10"],
  ["ai_leverage", "AI & scale 0-10"], ["operational_burden", "Low burden 0-10"], ["capital_risk", "Risk 0-10"],
];

function changed(current: Record<string, unknown> | undefined, data: Record<string, unknown>, skip: string[] = []) {
  if (!current) return [];
  const out: FieldChange[] = [];
  for (const [field, to] of Object.entries(data)) {
    if (skip.includes(field)) continue;
    if (!same(current[field], to)) out.push({ field, label: field, from: current[field] ?? null, to });
  }
  return out;
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
    fileSha256, fileVersion: null, sheetsFound: [], sheetsIgnored: [], opportunities: [], evidence: [], experiments: [], superseded: [],
    decisions: [], competitors: [], nicheScans: [], scores: [], briefsNeeded: [], skippedExamples: [], warnings: [], previousImportOfSameFile: null,
  };
  const [prevRun] = await sql`select at from import_runs where file_sha256 = ${fileSha256} order by at desc limit 1`;
  if (prevRun) plan.previousImportOfSameFile = new Date(prevRun.at).toISOString();

  for (const ws of sheets) for (const row of ws.rows.slice(0, 15)) {
    if (/^report version$/i.test(String(row?.[0] ?? "").trim()) && str(row?.[1] ?? null)) plan.fileVersion = String(row[1]).trim();
  }
  const version = plan.fileVersion ?? "workbook";

  const existing = await sql`select * from opportunities`;
  const matched = new Set<string>();
  const findExisting = (key: string, nn: string, code: string | null, name: string, rank: number | null) => {
    const free = existing.filter((e) => !matched.has(e.id));
    let hit = free.find((e) => e.importKey === key) ?? free.find((e) => e.normalizedName === nn);
    if (!hit && code) {
      const holder = free.find((e) => e.code === code);
      if (holder) {
        const hn = holder.normalizedName as string;
        const sameRank = rank !== null && holder.legacyRank === rank && String(holder.importKey ?? "").startsWith("register:");
        if (sameRank || hn.includes(nn) || nn.includes(hn) || findSimilar(name, null, [{ id: holder.id, code: holder.code, name: holder.name, description: null }], 0.3).length) hit = holder;
      }
    }
    if (hit) matched.add(hit.id);
    return hit;
  };
  const takenCodes = new Set(existing.map((e) => e.code as string));
  const evExisting = new Map((await sql`select * from evidence`).map((e) => [e.code as string, e]));
  const reclassified = new Set((await sql`select distinct entity_id from audit_log where entity = 'evidence' and action = 'reclassified'`).map((r) => r.entityId));
  const exExisting = new Map((await sql`select * from experiments`).map((e) => [e.code as string, e]));
  const dhKeys = new Set((await sql`select import_key from decision_history where import_key is not null`).map((e) => e.importKey));
  const compExisting = new Map((await sql`select * from competitors`).map((c) => [c.importKey as string, c]));
  const nsExisting = new Map((await sql`select * from niche_scans`).map((c) => [c.scanId as string, c]));
  const intakeRows: { title: string; r: Row }[] = [];
  const evalRows = new Map<string, Rec>();
  const briefs = new Map<string, BriefPairs>();
  const deprecatedTests: Row[] = [];

  const addOpportunity = (o: Omit<OppPlan, "status" | "duplicateOf" | "changes" | "conflicts" | "refresh" | "missingFields" | "code">, wantCode: string | null) => {
    const hit = findExisting(o.key, normalizeName(o.name), wantCode, o.name, o.rank);
    let code: string | null = hit?.code ?? null;
    if (!hit && wantCode) {
      if (takenCodes.has(wantCode)) plan.warnings.push(`${wantCode} is already used in AVI by a different idea, so "${o.name}" will get the next free code.`);
      else code = wantCode;
    }
    if (code) takenCodes.add(code);
    let changes: FieldChange[] = [], conflicts: FieldChange[] = [], refresh = false;
    if (hit) {
      ({ changes, conflicts } = mergeFields(hit, o.data, baselineFrom(hit.importRaw)));
      refresh = changes.length > 0 || WORKBOOK_OWNED.some((f) => f !== "importSource" && !same(hit[f], o.data[f] ?? null));
    }
    plan.opportunities.push({
      ...o, code, status: hit ? "duplicate" : "new", duplicateOf: hit?.code, changes, conflicts, refresh,
      missingFields: KEY_FIELDS.filter(([k]) => !o.data[k] && !(hit && hit[k])).map(([, label]) => label),
    });
  };

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
        const key = `register:${normalizeName(name)}`;
        if (seen.has(key)) { plan.warnings.push(`${title} row ${r.__row}: "${name}" appears twice in the file; second copy skipped.`); continue; }
        seen.add(key);
        const data: Record<string, unknown> = { ...mapRegisterRow(r), importSource: `${title} (row ${r.__row})`, importKey: key };
        const rank = data.legacyRank as number | null;
        const wantCode = aviCode(pick(r, "Opportunity ID")) ?? (rank ? `AVI-${String(rank).padStart(3, "0")}` : null);
        addOpportunity({ key, row: r.__row, name, rank, legacyScore: data.legacyScore as number | null, data,
          evidenceIds: expandIds(str(pick(r, "Evidence reference IDs", "Evidence IDs"))), sourceId: wantCode ?? undefined }, wantCode);
      }
      continue;
    }
    // ---- Evidence & sources
    const ev = readSheet(ws, (h) => h.includes("evidence id"));
    if (ev) {
      plan.sheetsFound.push(title);
      for (const r of ev.rows) {
        const code = str(pick(r, "Evidence ID"))?.trim().toUpperCase();
        const claim = str(pick(r, "Claim / finding", "Claim", "Finding"));
        if (!code || !claim) continue;
        const original = str(pick(r, "Evidence classification", "Classification"));
        const flag = str(pick(r, "Verified?"));
        const url = str(pick(r, "Source / verification link", "Source", "URL"));
        const extra = [["grain", pick(r, "Evidence grain")], ["method", pick(r, "Method")], ["geography", pick(r, "Geography")]]
          .filter(([, v]) => str(v as Cell)).map(([k, v]) => `${k}: ${v}`).join(" · ");
        const limits = str(pick(r, "Confidence / limitations", "Limitations"));
        const key = `evidence:${code}`;
        const classification = mapEvidence(original, flag);
        const data: Record<string, unknown> = {
          code, claim, classification,
          originalClassification: [original, flag && `Verified? ${flag}`].filter(Boolean).join(" · ") || null,
          sourceUrl: url && /^https?:\/\//i.test(url) ? url : firstUrl(url),
          scope: str(pick(r, "Date / scope", "Date")) ?? str(pick(r, "Source date")),
          limitations: [limits, extra && `[${extra}]`].filter(Boolean).join(" ") || null,
          relevantTo: str(pick(r, "Relevant opportunities")), actionRequired: str(pick(r, "Action required")),
          importRaw: rawOf(r),
        };
        if (flag) data.sourceNote = `From workbook ${version}. "Verified? ${flag}" is the researcher's own check of the source (Grok research agent, per owner) — secondary evidence, not proof that buyers will pay.`;
        const cur = evExisting.get(code);
        const changes: FieldChange[] = [], conflicts: FieldChange[] = [];
        if (cur) {
          for (const f of ["claim", "originalClassification", "sourceUrl", "scope", "limitations", "relevantTo", "actionRequired"]) {
            if (!same(cur[f], data[f])) changes.push({ field: f, label: f, from: cur[f] ?? null, to: data[f] });
          }
          if (cur.classification !== classification) {
            (reclassified.has(cur.id) ? conflicts : changes).push({ field: "classification", label: "classification", from: cur.classification, to: classification });
          }
        }
        plan.evidence.push({
          key, code, claim, classification, original, status: cur ? "duplicate" : "new", data,
          // side notes in brackets ("also AVI-001/002 benchmarks") are context, not links
          linkCodes: (str(pick(r, "Relevant opportunities")) ?? "").replace(/\([^)]*\)/g, "").toUpperCase().match(/AVI-\d+/g) ?? [], changes, conflicts,
        });
      }
      continue;
    }
    // ---- Competitor & Alternatives (v1.3+)
    const comp = readSheet(ws, (h) => h.includes("alternative name"));
    if (comp) {
      plan.sheetsFound.push(title);
      const seenKeys = new Map<string, number>();
      for (const r of comp.rows) {
        const name = str(pick(r, "Alternative name"));
        if (!name) continue;
        const code = aviCode(pick(r, "Opportunity ID"));
        let key = `competitor:${code ?? "none"}:${normalizeName(name)}`;
        const n = (seenKeys.get(key) ?? 0) + 1;
        seenKeys.set(key, n);
        if (n > 1) key += `#${n}`;
        const src = str(pick(r, "Source URL"));
        const data = {
          opportunityCode: code, name, altType: str(pick(r, "Alt type")), price: str(pick(r, "Price AUD (dated)", "Price")),
          priceDate: str(pick(r, "Price date")), coverage: str(pick(r, "Wedge coverage")), switchingFriction: str(pick(r, "Switching friction")),
          gap: str(pick(r, "Gap vs our wedge")), sourceText: src, sourceUrl: firstUrl(src), checkedOn: str(pick(r, "Checked on")), importKey: key,
        };
        const cur = compExisting.get(key);
        plan.competitors.push({ key, data, status: !cur ? "new" : changed(cur, data).length ? "update" : "unchanged" });
      }
      continue;
    }
    // ---- Niche scan backlog (v1.3+)
    const ns = readSheet(ws, (h) => h.includes("scan id"));
    if (ns) {
      plan.sheetsFound.push(title);
      for (const r of ns.rows) {
        const scanId = str(pick(r, "Scan ID"));
        const niche = str(pick(r, "Niche observed", "Niche"));
        if (!scanId || !niche) continue;
        const data = { scanId, niche, source: str(pick(r, "Source")), observedOn: str(pick(r, "Date")),
          whyInteresting: str(pick(r, "Why interesting")), promoted: str(pick(r, "Promoted to Opportunity ID?", "Promoted")) };
        const cur = nsExisting.get(scanId);
        plan.nicheScans.push({ key: scanId, data, status: !cur ? "new" : changed(cur, data).length ? "update" : "unchanged" });
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
        const rank = num(pick(r, "Opportunity rank"));
        const opportunityCode = aviCode(pick(r, "Opportunity ID")) ?? (rank ? `AVI-${String(rank).padStart(3, "0")}` : null);
        const details: Record<string, Cell> = {};
        for (const [k, label] of [["buyer", "Buyer"], ["offer", "Offer"], ["channel", "Channel"], ["budgetCeilingAud", "Budget ceiling"],
          ["stopLoss", "Stop-loss"], ["customerTouchScore", "Customer-touch score"], ["passThreshold", "Pass threshold"]] as const) {
          const v = pick(r, label);
          if (str(v)) details[k] = v;
        }
        const data: Record<string, unknown> = {
          code, hypothesis: str(pick(r, "Hypothesis")), design: str(pick(r, "Test design")),
          successMetric: str(pick(r, "Success metric")), successThreshold: str(pick(r, "Success threshold")) ?? str(pick(r, "Pass threshold")),
          budgetAud: num(pick(r, "Budget AUD")), startDate: isoDate(pick(r, "Start date")), endDate: isoDate(pick(r, "End date")),
          status: (str(pick(r, "Status")) ?? "planned").toLowerCase(), actualSpendAud: num(pick(r, "Actual spend AUD")) ?? 0,
          result: str(pick(r, "Result / evidence URL")), decision: str(pick(r, "Decision")),
          lessons: str(pick(r, "Lessons / next action")), opportunityCode,
          details: Object.keys(details).length ? details : null, importKey: key,
        };
        const cur = exExisting.get(code);
        plan.experiments.push({ key, code, rank, ideaId: opportunityCode, status: cur ? "duplicate" : "new", data,
          changes: changed(cur, data, ["importKey"]) });
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
    // ---- Idea Evaluations
    const evals = readSheet(ws, (h) => h.includes("weighted /100") || (h.includes("next test") && h.includes("evidence quality")));
    if (evals) {
      plan.sheetsFound.push(title);
      for (const r of evals.rows) {
        if (isExample(r)) { plan.skippedExamples.push({ sheet: title, row: r.__row }); continue; }
        const id = str(pick(r, "ID"));
        if (id) evalRows.set(id.trim().toUpperCase(), r);
      }
      continue;
    }
    // ---- Validation Tests: deprecated from v1.3 (moved into Experiment Log)
    const deprecated = /^\s*deprecated/i.test(String(ws.rows[0]?.[0] ?? ""));
    const vt = readSheet(ws, (h) => h.includes("test id") && h.includes("idea id"));
    if (vt && deprecated) {
      plan.sheetsIgnored.push(`${title} (marked deprecated in the workbook)`);
      deprecatedTests.push(...vt.rows);
      continue;
    }
    if (vt) {
      plan.sheetsFound.push(title);
      for (const r of vt.rows) {
        const code = str(pick(r, "Test ID"));
        if (!code) continue;
        if (isExample(r)) { plan.skippedExamples.push({ sheet: title, row: r.__row }); continue; }
        const key = `experiment:${code}`;
        const result = str(pick(r, "Actual result"));
        const ideaId = aviCode(pick(r, "Idea ID"));
        const data: Record<string, unknown> = {
          code, hypothesis: str(pick(r, "Hypothesis")), design: str(pick(r, "14-day test", "Test design")),
          successThreshold: str(pick(r, "Success threshold")), budgetAud: num(pick(r, "Budget AUD")),
          status: !result || /not started/i.test(result) ? "planned" : result.toLowerCase().slice(0, 40),
          result: result && !/not started/i.test(result) ? result : null, decision: str(pick(r, "Decision")),
          evidenceUrl: (() => { const u = str(pick(r, "Evidence link")); return u && /^https?:\/\//i.test(u) ? u : null; })(),
          lessons: str(pick(r, "Next action")), opportunityCode: ideaId, importKey: key,
        };
        const cur = exExisting.get(code);
        plan.experiments.push({ key, code, rank: null, ideaId, status: cur ? "duplicate" : "new", data, changes: changed(cur, data, ["importKey"]) });
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

  // Ideas from the Idea Intake sheet that aren't already on the register sheet
  const registerCodes = new Set(plan.opportunities.map((o) => o.code ?? o.sourceId).filter(Boolean) as string[]);
  const seenIntake = new Set(plan.opportunities.map((o) => o.key));
  let unscoredEvalRows = 0;
  for (const { title, r } of intakeRows) {
    const name = str(pick(r, "Idea / niche"))!;
    const sourceId = aviCode(pick(r, "ID"));
    if (sourceId && registerCodes.has(sourceId)) continue; // promoted to the register in v1.3+
    const key = `register:${normalizeName(name)}`;
    if (seenIntake.has(key)) { plan.warnings.push(`${title} row ${r.__row}: "${name}" is already in the register sheet; skipped.`); continue; }
    seenIntake.add(key);
    const data: Record<string, unknown> = { ...mapIntakeRow(r, sourceId ? evalRows.get(sourceId) : undefined, sourceId ? briefs.get(sourceId) : undefined),
      importSource: `${title} (row ${r.__row})`, importKey: key };
    addOpportunity({ key, row: r.__row, name, rank: null, legacyScore: null, data, evidenceIds: [], sourceId: sourceId ?? undefined }, sourceId);
  }

  // Scores from the Idea Evaluations sheet (every criterion must be filled in)
  const v = await activeScoringVersion(sql);
  const currentScores = new Map((await sql`select o.code, s.criteria from scores s join opportunities o on o.id = s.opportunity_id
    where s.is_current and s.decision <> 'LEGACY'`).map((s) => [s.code as string, s.criteria as { key: string; score: number | null; evidence: string }[]]));
  for (const [id, r] of evalRows) {
    const opp = plan.opportunities.find((o) => o.code === id || o.sourceId === id || o.duplicateOf === id);
    const scores: Partial<Record<CriterionKey, number>> = {};
    for (const [k, col] of EVAL_COLS) { const n = num(pick(r, col)); if (n !== null && n >= 0 && n <= 10) scores[k] = n; }
    if (Object.keys(scores).length < CRITERIA.length) { if (Object.keys(scores).length) unscoredEvalRows++; continue; }
    if (!opp) { plan.warnings.push(`Idea Evaluations has scores for ${id} but that idea isn't in the file; they were not imported.`); continue; }
    const q = (str(pick(r, "Evidence quality")) ?? "").toLowerCase();
    const confidence = q.startsWith("verified") ? "Verified" : q.startsWith("partial") ? "Partial" : q ? "Unverified" : null;
    const blockerText = str(pick(r, "Critical blocker?"));
    const blocker = blockerText && !/^no\b/i.test(blockerText) ? blockerText : null;
    const s = toAviScore(scores, {}, confidence, blocker);
    const result = scoreOpportunity(s.criteria, s.gates, v.weights, v.thresholds);
    const code = opp.duplicateOf ?? opp.code ?? id;
    const cur = currentScores.get(code);
    const identical = cur && s.criteria.every((c) => cur.find((x) => x.key === c.key)?.score === c.score);
    plan.scores.push({ code, name: opp.name, scores, confidence, blocker, workbookDecision: str(pick(r, "Decision")),
      workbookTotal: num(pick(r, "Weighted /100")), aviTotal: result.weightedTotal, aviDecision: result.decision, status: identical ? "same" : "new" });
  }
  if (unscoredEvalRows) plan.warnings.push(`${unscoredEvalRows} row(s) on Idea Evaluations are only partly scored, so they were not imported as scores.`);

  // Deprecated Validation Tests migrated into the Experiment Log
  for (const r of deprecatedTests) {
    const code = str(pick(r, "Test ID"));
    const by = str(pick(r, "Migration status"))?.match(/EXP-[\w-]+/i)?.[0]?.toUpperCase();
    const cur = code ? exExisting.get(code) : undefined;
    if (code && by && cur && !/^superseded/.test(String(cur.status))) plan.superseded.push({ code, by });
  }

  // Research briefs the register points to that aren't in AVI yet
  const haveBriefs = new Set((await sql`select distinct opportunity_code from research_briefs`).map((b) => b.opportunityCode));
  const seenBrief = new Set<string>();
  for (const o of plan.opportunities) {
    const file = o.data.researchBriefFile as string | null;
    const code = file?.match(/AVI-\d+/i)?.[0]?.toUpperCase();
    if (!file || !code || seenBrief.has(code) || haveBriefs.has(code)) continue;
    seenBrief.add(code);
    plan.briefsNeeded.push({ code, file: file.split("/").pop()! });
  }

  // Evidence references that point nowhere
  const evCodes = new Set([...plan.evidence.map((e) => e.code), ...evExisting.keys()]);
  for (const o of plan.opportunities) {
    const missing = o.evidenceIds.filter((id) => !evCodes.has(id));
    if (missing.length) plan.warnings.push(`${o.name}: references evidence ${missing.join(", ")} which is not in the file.`);
  }
  const linked = new Set(plan.opportunities.flatMap((o) => o.evidenceIds));
  const unlinked = plan.evidence.filter((e) => !linked.has(e.code) && e.linkCodes.length === 0);
  if (unlinked.length) {
    plan.warnings.push(`Evidence ${unlinked.map((e) => e.code).join(", ")} is not referenced by any opportunity's evidence IDs. It is imported and kept with its "relevant opportunities" text, but not linked automatically.`);
  }
  const conflictCount = plan.opportunities.reduce((n, o) => n + o.conflicts.length, 0) + plan.evidence.reduce((n, e) => n + e.conflicts.length, 0);
  if (conflictCount) plan.warnings.push(`${conflictCount} value(s) were changed by you in AVI and also differ in the workbook. AVI keeps your values unless you tick "use the workbook's values".`);
  if (plan.opportunities.length === 0) plan.warnings.push("No opportunity register sheet was recognised (needs 'Rank' and 'Opportunity' columns).");
  return plan;
}

export async function commitImport(sql: Sql, plan: ImportPlan, filename: string, opts: { overwriteConflicts?: boolean } = {}) {
  const version = plan.fileVersion ?? "workbook";
  return sql.begin(async (tx) => {
    const [legacy] = await tx`select id from scoring_versions where is_legacy order by id limit 1`;
    const created: string[] = [];
    let updated = 0, conflictsKept = 0;

    for (const o of plan.opportunities) {
      if (o.status === "duplicate") {
        const [ex] = await tx`select * from opportunities where code = ${o.duplicateOf!} for update`;
        if (!ex) continue;
        const apply = [...o.changes, ...(opts.overwriteConflicts ? o.conflicts : [])];
        if (!opts.overwriteConflicts) conflictsKept += o.conflicts.length;
        if (!o.refresh && apply.length === 0) continue;
        const set: Record<string, unknown> = {};
        for (const f of WORKBOOK_OWNED) if (f in o.data) set[f] = o.data[f] ?? null;
        for (const c of apply) set[c.field] = c.to;
        if ("name" in set) set.normalizedName = normalizeName(String(set.name));
        if (ex.importKey !== o.key && !(await tx`select 1 from opportunities where import_key = ${o.key}`).length) set.importKey = o.key;
        set.updatedAt = new Date();
        await tx`update opportunities set ${tx(set as never)} where id = ${ex.id}`;
        if (apply.length) updated++;
        const stage = apply.find((c) => c.field === "stage");
        if (stage) {
          await tx`insert into decision_history (opportunity_id, old_decision, new_decision, reason, source)
            values (${ex.id}, ${`Stage: ${stage.from}`}, ${`Stage: ${stage.to}`},
            ${`Workbook decision status is now "${o.data.legacyDecision ?? ""}".`}, ${`Workbook ${version} import`})`;
        }
        await audit(tx, "opportunity", ex.id, "updated_from_workbook", {
          file: filename, version, changed: Object.fromEntries(apply.map((c) => [c.field, { from: c.from, to: c.to }])),
          keptYourValues: opts.overwriteConflicts ? [] : o.conflicts.map((c) => c.field),
        });
        continue;
      }
      let code = o.code;
      if (!code || (await tx`select 1 from opportunities where code = ${code}`).length) code = await nextCode(tx);
      const data = { ...o.data, code };
      const [row] = await tx`insert into opportunities ${tx(data as never)} returning id, code`;
      created.push(row.code);
      if (o.legacyScore !== null && legacy) {
        await tx`insert into scores (opportunity_id, scoring_version_id, weighted_total, decision, decision_reasons, is_current)
          values (${row.id}, ${legacy.id}, ${o.legacyScore}, 'LEGACY',
          ${["Original subjective screening total from the workbook; criteria were not individually scored and it is not demand evidence."]}::jsonb, false)`;
      }
      await audit(tx, "opportunity", row.id, "imported", { file: filename, source: o.data.importSource, legacyScore: o.legacyScore });
    }
    // Keep new-idea codes ahead of imported ones
    await tx`select setval('opportunity_code_seq', greatest((select coalesce(max(substring(code from 5)::int), 25)
      from opportunities where code ~ '^AVI-[0-9]+$'), 25))`;

    // Every code in the file now resolves to an AVI idea
    const all = await tx`select id, code, import_key from opportunities`;
    const idByCode = new Map(all.map((r) => [r.code as string, r.id as string]));
    const codeByKey = new Map(all.filter((r) => r.importKey).map((r) => [r.importKey as string, r.code as string]));
    const planCode = new Map<string, string>(); // code used in the workbook → AVI code
    const aviCodeOf = (o: OppPlan) => o.duplicateOf ?? codeByKey.get(o.key);
    for (const o of plan.opportunities) {
      const avi = aviCodeOf(o);
      if (!avi) continue;
      if (o.sourceId) planCode.set(o.sourceId, avi);
      if (o.code) planCode.set(o.code, avi);
    }
    const resolve = (code: string | null | undefined) => (code ? idByCode.get(planCode.get(code) ?? code) ?? null : null);

    let evidenceCreated = 0, evidenceUpdated = 0;
    for (const e of plan.evidence) {
      if (e.status === "new") {
        const r = await tx`insert into evidence ${tx({ ...e.data, importKey: e.key } as never)} on conflict do nothing returning 1`;
        evidenceCreated += r.length;
        continue;
      }
      const apply = [...e.changes, ...(opts.overwriteConflicts ? e.conflicts : [])];
      if (!opts.overwriteConflicts) conflictsKept += e.conflicts.length;
      const set: Record<string, unknown> = { importRaw: e.data.importRaw };
      for (const c of apply) set[c.field] = c.to;
      await tx`update evidence set ${tx(set as never)} where code = ${e.code}`;
      if (e.data.sourceNote) await tx`update evidence set source_note = ${e.data.sourceNote as string} where code = ${e.code} and source_note is null`;
      if (apply.length) {
        evidenceUpdated++;
        const [row] = await tx`select id from evidence where code = ${e.code}`;
        await audit(tx, "evidence", row.id, "updated_from_workbook", { file: filename, version, changed: apply.map((c) => c.field) });
      }
    }
    // Links: the opportunity's evidence IDs, plus AVI codes named in the evidence row
    let links = 0;
    const link = async (oppId: string | null, code: string) => {
      if (!oppId) return;
      const r = await tx`insert into opportunity_evidence (opportunity_id, evidence_id)
        select ${oppId}, id from evidence where code = ${code} on conflict do nothing returning 1`;
      links += r.length;
    };
    for (const o of plan.opportunities) {
      const avi = aviCodeOf(o);
      for (const code of o.evidenceIds) await link(avi ? idByCode.get(avi) ?? null : null, code);
    }
    for (const e of plan.evidence) for (const c of e.linkCodes) await link(resolve(c), e.code);

    let experimentsCreated = 0, experimentsUpdated = 0;
    for (const x of plan.experiments) {
      const oppId = resolve(x.ideaId ?? (x.rank ? `AVI-${String(x.rank).padStart(3, "0")}` : null));
      if (x.status === "new") {
        await tx`insert into experiments ${tx({ ...x.data, opportunityId: oppId } as never)} on conflict (import_key) do nothing`;
        experimentsCreated++;
        continue;
      }
      const set: Record<string, unknown> = Object.fromEntries(x.changes.map((c) => [c.field, c.to]));
      const [cur] = await tx`select opportunity_id from experiments where code = ${x.code}`;
      if (oppId && cur?.opportunityId !== oppId) set.opportunityId = oppId;
      if (!Object.keys(set).length) continue;
      await tx`update experiments set ${tx(set as never)} where code = ${x.code}`;
      experimentsUpdated++;
    }
    for (const s of plan.superseded) {
      await tx`update experiments set status = ${`superseded by ${s.by}`},
        lessons = trim(coalesce(lessons, '') || ${` Migrated to ${s.by} in the workbook's Experiment Log.`}) where code = ${s.code}`;
    }

    let decisionsCreated = 0;
    for (const d of plan.decisions) {
      const ideaKey = d.ideaId?.toUpperCase().trim();
      const oppId = ideaKey && /^AVI-\d+$/.test(ideaKey) ? resolve(ideaKey) : null;
      if (d.status === "duplicate") {
        // An earlier import may have stored this row before its idea existed; attach it now.
        if (oppId) await tx`update decision_history set opportunity_id = ${oppId} where import_key = ${d.key} and opportunity_id is null`;
        continue;
      }
      await tx`insert into decision_history ${tx({ ...d.data, opportunityId: oppId } as never)} on conflict (import_key) do nothing`;
      decisionsCreated++;
    }

    let competitors = 0;
    for (const c of plan.competitors) {
      if (c.status === "unchanged") continue;
      const row = { ...c.data, opportunityId: resolve(c.data.opportunityCode as string | null), updatedAt: new Date() } as never;
      await tx`insert into competitors ${tx(row)} on conflict (import_key) do update set ${tx(row)}`;
      competitors++;
    }
    let nicheScans = 0;
    for (const n of plan.nicheScans) {
      if (n.status === "unchanged") continue;
      const row = { ...n.data, updatedAt: new Date() } as never;
      await tx`insert into niche_scans ${tx(row)} on conflict (scan_id) do update set ${tx(row)}`;
      nicheScans++;
    }

    const scored: string[] = [];
    for (const s of plan.scores) {
      if (s.status === "same") continue;
      const oppId = resolve(s.code);
      if (!oppId) continue;
      const a = toAviScore(s.scores, {}, s.confidence, s.blocker);
      const note = `Workbook Idea Evaluations (${version})${s.workbookDecision ? ` — workbook decision: ${s.workbookDecision}` : ""}`;
      for (const c of a.criteria) c.rationale = note.slice(0, 1000);
      await saveScore(oppId, a.criteria, a.gates, `Workbook Idea Evaluations (${version})`, tx);
      scored.push(s.code);
    }

    const summary = {
      fileVersion: plan.fileVersion,
      opportunitiesCreated: created.length, opportunitiesUpdated: updated,
      opportunitiesSkippedAsDuplicate: plan.opportunities.filter((o) => o.status === "duplicate").length - updated,
      conflictsKept, evidenceCreated, evidenceUpdated, evidenceLinks: links, experimentsCreated, experimentsUpdated,
      experimentsSuperseded: plan.superseded.length, decisionsCreated, competitors, nicheScans, scored,
      skippedExamples: plan.skippedExamples.length, briefsNeeded: plan.briefsNeeded, warnings: plan.warnings,
    };
    await tx`insert into import_runs (filename, file_sha256, summary) values (${filename}, ${plan.fileSha256}, ${summary as never}::jsonb)`;
    await audit(tx, "import", plan.fileSha256.slice(0, 12), "committed", summary);
    return summary;
  });
}

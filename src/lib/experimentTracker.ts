// Reads an experiment tracking workbook (e.g. "AVI-002 EXP-002r1 Tracking Sheet") and works out
// the go / no-go result from the raw rows. Pure: no database access.
// Only counts, minutes and dollar totals are kept — never names, notes or anything identifying.
import type { SheetData } from "./xlsxReader";

type Cell = string | number | null;

export type TrackerRules = {
  passMedianMin: number; passResidualPct: number; stopMedianMin: number; stopRemovedPct: number;
  phaseBEnd: string | null; // last day of the phase B window, e.g. "Phase B (8–16 Nov" → 16 Nov
  successPractices: number; successFiles: number; maxOwnerMinPerFile: number; minLodgementScore: number; stopOutreachNoPaid: number;
};
export type PhaseADecision = "PASS" | "BORDERLINE" | "STOP" | "PENDING";
export type PhaseBDecision = "SUCCESS" | "INVESTIGATE MORE" | "STOP" | "IN PROGRESS" | "NOT STARTED";

export type TrackerResult = {
  title: string;
  experimentCode: string | null;
  opportunityCode: string | null;
  rules: TrackerRules;
  phaseA: {
    filesExpected: number; filesTimed: number; filesWithToolData: number;
    medianManualMin: number | null; totalManualMin: number; medianExceptions: number | null;
    exceptionTotals: Record<string, number>; residualPct: number | null; removedPct: number | null;
    decision: PhaseADecision; reasons: string[];
  };
  phaseB: {
    outreach: number; replies: number; paidPractices: number; paidFiles: number; revenueExGst: number;
    ownerMinPerFile: number | null; avgLodgementScore: number | null; refunds: number; refundTotal: number;
    decision: PhaseBDecision; reasons: string[];
  };
  spend: { spent: number; ceiling: number | null; remaining: number | null; over: boolean };
  warnings: string[];
};

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const num = (v: Cell | undefined) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const yes = (v: Cell | undefined) => /^y(es)?$/i.test(String(v ?? "").trim());
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

function sheet(sheets: SheetData[], name: string) {
  return sheets.find((s) => norm(s.name) === norm(name));
}
/** Rows as records keyed by the header row (the first row whose first cell is filled). */
function records(ws: SheetData | undefined, firstHeader: string) {
  if (!ws) return [];
  const hi = ws.rows.findIndex((r) => norm(r?.[0]) === norm(firstHeader));
  if (hi < 0) return [];
  const headers = (ws.rows[hi] ?? []).map((h) => String(h ?? "").trim());
  return ws.rows.slice(hi + 1).map((row) => {
    const rec: Record<string, Cell> = {};
    headers.forEach((h, i) => { if (h) rec[h] = (row?.[i] ?? null) as Cell; });
    return rec;
  });
}
const col = (rec: Record<string, Cell>, ...starts: string[]) => {
  for (const [k, v] of Object.entries(rec)) if (starts.some((s) => norm(k).startsWith(norm(s)))) return v;
  return null;
};

export function isTrackerWorkbook(sheets: SheetData[]) {
  return Boolean(sheet(sheets, "File_Log") && sheet(sheets, "GoNoGo"));
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function phaseBEnd(text: string): string | null {
  const m = text.match(/Phase B\s*\(\s*\d{1,2}\s*[–—-]\s*(\d{1,2})\s+([A-Za-z]{3})/i);
  const mon = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
  if (!m || mon < 0) return null;
  const year = Number(text.match(/\b(20\d{2})\b/)?.[1] ?? new Date().getUTCFullYear());
  return `${year}-${String(mon + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function parseRules(text: string): TrackerRules {
  const n = (re: RegExp, d: number) => { const m = text.match(re); return m ? Number(m[1]) : d; };
  return {
    phaseBEnd: phaseBEnd(text),
    passMedianMin: n(/PASS if median manual minutes\s*≥\s*(\d+)/i, 30),
    passResidualPct: n(/not removed by tools\s*≥\s*(\d+)\s*%/i, 40),
    stopMedianMin: n(/STOP if median\s*<\s*(\d+)/i, 20),
    stopRemovedPct: n(/tools remove\s*>\s*(\d+)\s*%/i, 70),
    successPractices: n(/≥\s*(\d+)\s*paying practices/i, 3),
    successFiles: n(/≥\s*(\d+)\s*files/i, 15),
    maxOwnerMinPerFile: n(/≤\s*(\d+)\s*owner-min\/file/i, 20),
    minLodgementScore: n(/≥\s*(\d+)\s*\/\s*5\s*lodgement-ready/i, 4),
    stopOutreachNoPaid: n(/0 paid after\s*≥\s*(\d+)\s*outreach/i, 40),
  };
}

/** `today` is YYYY-MM-DD in the owner's time zone; it decides whether the phase B window has closed. */
export function parseTracker(sheets: SheetData[], filename = "", today: string = new Date().toISOString().slice(0, 10)): TrackerResult {
  const instr = sheet(sheets, "Instructions");
  const instrText = (instr?.rows ?? []).map((r) => (r ?? []).filter((c) => c !== null).join(" ")).join("\n");
  const title = String(instr?.rows[0]?.[0] ?? filename).trim();
  const experimentCode = (title.match(/EXP-[0-9]+[A-Za-z0-9-]*/i) ?? filename.match(/EXP-[0-9]+[A-Za-z0-9-]*/i))?.[0]?.replace(/_.*$/, "") ?? null;
  const opportunityCode = (title.match(/AVI-\d+/i) ?? filename.match(/AVI-\d+/i))?.[0]?.toUpperCase() ?? null;
  const rules = parseRules(instrText);
  const warnings: string[] = [];

  // ---- Phase A: manual timing and tool comparison
  const files = records(sheet(sheets, "File_Log"), "FileID").filter((r) => /^F\d+$/i.test(String(r.FileID ?? "").trim()));
  const timed = files.filter((r) => num(col(r, "Manual clear")) !== null);
  const manualById = new Map(timed.map((r) => [String(r.FileID).trim().toUpperCase(), num(col(r, "Manual clear"))!]));
  const exKeys = ["X1", "X2", "X3", "X4", "X5"];
  const exceptionTotals: Record<string, number> = Object.fromEntries(exKeys.map((k) => [k, 0]));
  const perFileExceptions: number[] = [];
  for (const r of timed) {
    let sum = 0, any = false;
    for (const k of exKeys) { const v = num(col(r, k)); if (v !== null) { exceptionTotals[k] += v; sum += v; any = true; } }
    const total = num(col(r, "Total exceptions"));
    if (total !== null || any) perFileExceptions.push(any ? sum : total!);
  }
  const tools = records(sheet(sheets, "Tool_Compare"), "FileID").filter((r) => /^F\d+$/i.test(String(r.FileID ?? "").trim()));
  let manualWithTools = 0, removed = 0, filesWithToolData = 0;
  for (const r of tools) {
    const id = String(r.FileID).trim().toUpperCase();
    const m = manualById.get(id);
    const rem = num(col(r, "Best-combo est. minutes removed", "Best combo"));
    if (m === undefined || rem === null) continue;
    filesWithToolData++;
    manualWithTools += m;
    removed += Math.min(Math.max(rem, 0), m);
  }
  const med = median([...manualById.values()]);
  const removedPct = manualWithTools > 0 ? r1((removed / manualWithTools) * 100) : null;
  const residualPct = removedPct === null ? null : r1(100 - removedPct);
  const reasonsA: string[] = [];
  let decisionA: PhaseADecision = "PENDING";
  const complete = files.length > 0 && timed.length === files.length && filesWithToolData === timed.length;
  if (!complete) {
    reasonsA.push(`${timed.length} of ${files.length} files timed; tool comparison filled for ${filesWithToolData}.`);
  } else if (med! < rules.stopMedianMin || removedPct! > rules.stopRemovedPct) {
    decisionA = "STOP";
    if (med! < rules.stopMedianMin) reasonsA.push(`Median manual clear ${med} min is under ${rules.stopMedianMin} min — not enough time to sell.`);
    if (removedPct! > rules.stopRemovedPct) reasonsA.push(`Existing tools remove ${removedPct}% of the time (stop above ${rules.stopRemovedPct}%).`);
  } else if (med! >= rules.passMedianMin && residualPct! >= rules.passResidualPct) {
    decisionA = "PASS";
    reasonsA.push(`Median manual clear ${med} min (≥${rules.passMedianMin}) and ${residualPct}% of the time is left after tools (≥${rules.passResidualPct}%).`);
  } else {
    decisionA = "BORDERLINE";
    reasonsA.push(`Median ${med} min and ${residualPct}% left after tools: between the pass and stop lines — your review needed.`);
  }

  // ---- Phase B: paid pilot pipeline
  const pipeAll = records(sheet(sheets, "PhaseB_Pipeline"), "Prospect (practice, no client data)");
  const summaryAt = pipeAll.findIndex((r) => /^summary$/i.test(String(Object.values(r)[0] ?? "").trim()));
  // a prospect row counts once it has a channel, a contact date or a reply; the sheet's own summary block is ignored
  const pipe = (summaryAt >= 0 ? pipeAll.slice(0, summaryAt) : pipeAll)
    .filter((r) => [col(r, "Channel"), col(r, "Date contacted"), col(r, "Reply"), col(r, "Paid")].some((v) => v !== null && String(v).trim() !== ""));
  const paid = pipe.filter((r) => yes(col(r, "Paid")));
  const paidFiles = paid.reduce((s, r) => s + (num(col(r, "Files")) ?? 0), 0);
  const ownerMin = paid.reduce((s, r) => s + (num(col(r, "Delivery owner-min total")) ?? 0), 0);
  const scores = paid.map((r) => num(col(r, "Lodgement-ready"))).filter((x): x is number => x !== null);
  const refundRows = pipe.filter((r) => yes(col(r, "Refund (Y/N)")));
  const phaseB = {
    outreach: pipe.length,
    replies: pipe.filter((r) => yes(col(r, "Reply"))).length,
    paidPractices: paid.length,
    paidFiles,
    revenueExGst: paid.reduce((s, r) => s + (num(col(r, "Amount")) ?? 0), 0),
    ownerMinPerFile: paidFiles > 0 && ownerMin > 0 ? r1(ownerMin / paidFiles) : null,
    avgLodgementScore: scores.length ? r1(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    refunds: refundRows.length,
    refundTotal: refundRows.reduce((s, r) => s + (num(col(r, "Refund A$")) ?? 0), 0),
    decision: "NOT STARTED" as PhaseBDecision,
    reasons: [] as string[],
  };
  if (pipe.length) {
    const ok = phaseB.paidPractices >= rules.successPractices && phaseB.paidFiles >= rules.successFiles
      && phaseB.ownerMinPerFile !== null && phaseB.ownerMinPerFile <= rules.maxOwnerMinPerFile
      && phaseB.avgLodgementScore !== null && phaseB.avgLodgementScore >= rules.minLodgementScore;
    if (ok) {
      phaseB.decision = "SUCCESS";
      phaseB.reasons.push(`${phaseB.paidPractices} practices paid for ${phaseB.paidFiles} files at ${phaseB.ownerMinPerFile} owner-min/file, lodgement-ready ${phaseB.avgLodgementScore}/5.`);
    } else if (phaseB.paidPractices === 0 && phaseB.outreach >= rules.stopOutreachNoPaid) {
      phaseB.decision = "STOP";
      phaseB.reasons.push(`No paid practices after ${phaseB.outreach} outreaches (stop rule: ${rules.stopOutreachNoPaid}).`);
    } else if (rules.phaseBEnd && today > rules.phaseBEnd) {
      // window closed: some buyers paid but the success bar wasn't met → keep investigating; nobody paid → stop
      if (phaseB.paidPractices > 0) {
        phaseB.decision = "INVESTIGATE MORE";
        phaseB.reasons.push(`Window closed ${rules.phaseBEnd}: ${phaseB.paidPractices} paying practice(s) and ${phaseB.paidFiles} files — short of the success bar (${rules.successPractices} practices, ${rules.successFiles} files, ≤${rules.maxOwnerMinPerFile} owner-min/file on average, lodgement-ready ≥${rules.minLodgementScore}/5).`);
      } else {
        phaseB.decision = "STOP";
        phaseB.reasons.push(`Window closed ${rules.phaseBEnd} with no paying practices.`);
      }
    } else {
      phaseB.decision = "IN PROGRESS";
      phaseB.reasons.push(`${phaseB.paidPractices}/${rules.successPractices} paying practices, ${phaseB.paidFiles}/${rules.successFiles} files after ${phaseB.outreach} outreaches.`);
    }
    if (decisionA !== "PASS") warnings.push("Phase B has entries but Phase A hasn't passed yet.");
  }

  // ---- Spend
  const spendWs = sheet(sheets, "Spend_Log");
  let ceiling: number | null = null;
  for (const r of spendWs?.rows ?? []) {
    const i = (r ?? []).findIndex((c) => /budget ceiling/i.test(String(c ?? "")));
    if (i >= 0) ceiling = num(r[i + 1] as Cell);
  }
  const spent = records(spendWs, "Date").reduce((s, r) => s + (num(col(r, "Amount")) ?? 0), 0);

  if (!experimentCode) warnings.push("No experiment code (EXP-…) found in the sheet title or file name.");
  return {
    title, experimentCode, opportunityCode, rules,
    phaseA: {
      filesExpected: files.length, filesTimed: timed.length, filesWithToolData, medianManualMin: med,
      totalManualMin: [...manualById.values()].reduce((a, b) => a + b, 0), medianExceptions: median(perFileExceptions),
      exceptionTotals, residualPct, removedPct, decision: decisionA, reasons: reasonsA,
    },
    phaseB,
    spend: { spent, ceiling, remaining: ceiling === null ? null : ceiling - spent, over: ceiling !== null && spent > ceiling },
    warnings,
  };
}

/** One-line status for the experiment record. */
export function trackerStatus(t: TrackerResult, previous: string): string {
  if (t.phaseB.decision === "SUCCESS") return "succeeded";
  if (t.phaseB.decision === "STOP") return "stopped (no paid pilots)";
  if (t.phaseB.decision === "INVESTIGATE MORE") return "investigate more";
  if (t.phaseA.decision === "STOP") return "stopped (phase A)";
  if (t.phaseB.decision === "IN PROGRESS") return "phase B running";
  if (t.phaseA.decision === "PASS") return "phase A passed";
  if (t.phaseA.decision === "BORDERLINE") return "phase A borderline — review";
  if (t.phaseA.filesTimed > 0) return "phase A running";
  return previous;
}

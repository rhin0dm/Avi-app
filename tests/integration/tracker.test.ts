import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resetTestDb, TEST_DATABASE_URL } from "../helpers/db";
import type { SheetData } from "@/lib/xlsxReader";

process.env.DATABASE_URL = TEST_DATABASE_URL;
const { getSql } = await import("@/lib/db");
const { readXlsx } = await import("@/lib/xlsxReader");
const { parseTracker, isTrackerWorkbook } = await import("@/lib/experimentTracker");
const { planTracker, commitTracker } = await import("@/lib/trackerImport");
const { planImport, commitImport } = await import("@/lib/importer");
const { planDocument, commitDocument, isResearchBrief } = await import("@/lib/briefImport");
const sql = getSql();

const INSTR = [
  ["AVI-002 EXP-002r1 Tracking Sheet v1.0 — Pre-BAS Exception Clear (created 1 Nov 2026)"],
  ["GoNoGo: PASS if median manual minutes ≥30 AND residual time not removed by tools ≥40%. STOP if median <20 OR tools remove >70%. Otherwise BORDERLINE (review)."],
  ["Phase B (8–16 Nov, only if PASS): Success = ≥3 paying practices, ≥15 files, ≤20 owner-min/file, ≥4/5 lodgement-ready. Stop by day 11 if 0 paid after ≥40 outreaches."],
];
const FILE_HEAD = ["FileID", "Client size band", "Date timed", "Manual clear (min)", "X1 Missing tax invoice >A$82.50", "X2 Unclear bank lines",
  "X3 GST treatment errors", "X4 Transfers/interco/drawings", "X5 Part/batch/dup/Dext-Xero", "Total exceptions", "Notes (no identifiers)"];
const TOOL_HEAD = ["FileID", "XBert flagged", "XBert resolved", "Best-combo est. minutes removed", "Manual min (from File_Log)", "Residual min"];
const PIPE_HEAD = ["Prospect (practice, no client data)", "Channel", "Date contacted", "Reply (Y/N/Pending)", "Paid (Y/N)", "Amount A$ ex GST", "Files",
  "Delivery owner-min total", "Owner-min/file", "Lodgement-ready score (0-5)", "Refund (Y/N)", "Refund A$", "Notes"];

function book(manual: number[], removed: number[], pipeline: (string | number | null)[][] = [], spend: number[] = []): SheetData[] {
  const ids = manual.map((_, i) => `F${String(i + 1).padStart(2, "0")}`);
  return [
    { name: "Instructions", rows: INSTR },
    { name: "File_Log", rows: [FILE_HEAD, ...ids.map((id, i) => [id, null, null, manual[i], 1, 2, 1, 0, 1, null, null]), ["MEDIAN"], ["TOTAL"]] },
    { name: "Tool_Compare", rows: [TOOL_HEAD, ...ids.map((id, i) => [id, 3, 1, removed[i], manual[i], null])] },
    { name: "GoNoGo", rows: [["Metric", "Value"]] },
    { name: "PhaseB_Pipeline", rows: [PIPE_HEAD, ...pipeline] },
    { name: "Spend_Log", rows: [["Date", "Item", "Category", "Amount A$ ex GST", "GST A$", "Notes", null, "Budget ceiling A$", 500],
      ...spend.map((a) => ["2026-11-05", "Tool trial", "Software", a, null, null])] },
  ] as SheetData[];
}

describe("tracking sheet rules", () => {
  it("is pending until every file is timed", () => {
    const t = parseTracker(book([40, 35, null as never], [5, 5, null as never]));
    expect(t.experimentCode).toBe("EXP-002r1");
    expect(t.opportunityCode).toBe("AVI-002");
    expect(t.phaseA.decision).toBe("PENDING");
  });
  it("passes, stops and flags borderline from the raw rows", () => {
    expect(parseTracker(book([40, 30, 34], [10, 10, 10])).phaseA).toMatchObject({ decision: "PASS", medianManualMin: 34, medianExceptions: 5 });
    expect(parseTracker(book([15, 18, 25], [0, 0, 0])).phaseA.decision).toBe("STOP"); // median 18 < 20
    expect(parseTracker(book([40, 40, 40], [30, 30, 30])).phaseA.decision).toBe("STOP"); // tools remove 75%
    expect(parseTracker(book([25, 25, 25], [5, 5, 5])).phaseA.decision).toBe("BORDERLINE");
  });
  it("judges phase B and totals spend", () => {
    const paid = (n: number) => Array.from({ length: n }, (_, i) => [`Practice ${i}`, "Email", "2026-11-09", "Y", "Y", 245, 5, 90, null, 4.5, "N", null, null]);
    const t = parseTracker(book([40, 40], [10, 10], paid(3), [120, 30]));
    expect(t.phaseB).toMatchObject({ decision: "SUCCESS", paidPractices: 3, paidFiles: 15, ownerMinPerFile: 18, revenueExGst: 735 });
    expect(t.spend).toMatchObject({ spent: 150, ceiling: 500, over: false });
    const cold = Array.from({ length: 40 }, () => ["P", "Email", "2026-11-09", "N", "N", null, null, null, null, null, null, null, null]);
    expect(parseTracker(book([40, 40], [10, 10], cold)).phaseB.decision).toBe("STOP");
  });
});

const V14 = "local-data/v14.xlsx";
describe.runIf(existsSync(V14))("tracking sheet updates the experiment in AVI", () => {
  beforeAll(async () => {
    await resetTestDb();
    await commitImport(sql, await planImport(sql, new Uint8Array(readFileSync(V14))), "v14.xlsx");
  });

  it("reads the owner's blank sheet as pending", async () => {
    const f = "local-data/exp002r1.xlsx";
    if (!existsSync(f)) return;
    const sheets = await readXlsx(new Uint8Array(readFileSync(f)));
    expect(isTrackerWorkbook(sheets)).toBe(true);
    const plan = await planTracker(sql, sheets, "AVI-002_EXP-002r1_tracking_sheet_v1.0.xlsx");
    expect(plan.experiment?.code).toBe("EXP-002r1");
    expect(plan.tracker.phaseA).toMatchObject({ decision: "PENDING", filesExpected: 10, filesTimed: 0 });
    expect(plan.newStatus).toBe("planned");
  });

  it("records phase A, then paid pilots, and marks demand verified", async () => {
    const r1 = await commitTracker(sql, await planTracker(sql, book([40, 30, 34], [10, 10, 10]), "t.xlsx"), "t.xlsx");
    expect(r1).toMatchObject({ status: "phase A passed", phaseA: "PASS", decisionsLogged: 1, scoreUpdated: false });
    // give AVI-002 a current score so phase B can update it
    const [o] = await sql`select id from opportunities where code = 'AVI-002'`;
    const repo = await import("@/lib/repo");
    const { emptyGates, CRITERIA } = await import("@/lib/scoring");
    await repo.saveScore(o.id, CRITERIA.map((c) => ({ key: c.key, score: 6, evidence: "inference" as const })), emptyGates(), "test");
    const paid = Array.from({ length: 3 }, () => ["P", "Email", "2026-11-09", "Y", "Y", 245, 5, 90, null, 4.5, "N", null, null]);
    const r2 = await commitTracker(sql, await planTracker(sql, book([40, 30, 34], [10, 10, 10], paid), "t.xlsx"), "t.xlsx");
    expect(r2).toMatchObject({ status: "succeeded", phaseB: "SUCCESS", decisionsLogged: 1, scoreUpdated: true });
    const ev = await sql`select e.code, e.classification from evidence e join opportunity_evidence oe on oe.evidence_id = e.id
      where oe.opportunity_id = ${o.id} and e.code like 'EXP-002r1-%' order by 1`;
    expect(ev.map((e) => `${e.code}:${e.classification}`)).toEqual(["EXP-002r1-PAID:verified", "EXP-002r1-TIME:verified"]);
    const [cur] = await sql`select gates, criteria from scores where opportunity_id = ${o.id} and is_current and decision <> 'LEGACY'`;
    expect(cur.gates.find((g: { key: string }) => g.key === "willingness_to_pay").status).toBe("satisfied");
    expect(cur.criteria.find((c: { key: string }) => c.key === "demand").evidence).toBe("verified");
    // re-uploading the same data changes nothing further
    const r3 = await commitTracker(sql, await planTracker(sql, book([40, 30, 34], [10, 10, 10], paid), "t.xlsx"), "t.xlsx");
    expect(r3).toMatchObject({ decisionsLogged: 0, scoreUpdated: false });
  });

  it("keeps a non-brief Markdown file as a document on the idea", async () => {
    const text = "# Sample Pack Outline — Pre-BAS Exception Clear (v1.0)\n\nSYNTHETIC DEMO ONLY.";
    expect(isResearchBrief(text)).toBe(false);
    const plan = await planDocument(sql, text, "7870210f-AVI-002_sample_pack_outline_v1.0.md");
    expect(plan.opportunity?.code).toBe("AVI-002");
    const r = await commitDocument(sql, text, "7870210f-AVI-002_sample_pack_outline_v1.0.md");
    expect(r).toMatchObject({ code: "AVI-002", title: "Sample Pack Outline — Pre-BAS Exception Clear (v1.0)" });
    const [d] = await sql`select kind, version from research_briefs where opportunity_code = 'AVI-002'`;
    expect(d).toEqual({ kind: "document", version: "v1.0" });
  });
});

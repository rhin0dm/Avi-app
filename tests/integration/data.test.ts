import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resetTestDb, TEST_DATABASE_URL } from "../helpers/db";
import { makeRegisterWorkbook } from "../helpers/fixture";

process.env.DATABASE_URL = TEST_DATABASE_URL;
const { getSql } = await import("@/lib/db");
const repo = await import("@/lib/repo");
const { planImport, commitImport, checkUpload } = await import("@/lib/importer");
const { buildWorkbook, buildCsv, buildBackup } = await import("@/lib/exporter");
const { CRITERIA, GATES } = await import("@/lib/scoring");
const ExcelJS = (await import("exceljs")).default;

const sql = getSql();
const crit = (s: number[], evidence = "verified") => CRITERIA.map((c, i) => ({ key: c.key, score: s[i], evidence })) as never;
const gates = (status = "satisfied", evidence = "verified") => GATES.map((g) => ({ key: g.key, status, evidence })) as never;

beforeAll(resetTestDb);

describe("ideas and persistence (acceptance tests 1, 2)", () => {
  it("saves a submitted idea with a unique code before any research", async () => {
    const { opportunity } = await repo.createOpportunity({
      name: "Supplier price-increase detector", description: "AI software that identifies unexplained supplier price increases for Australian construction companies.",
      targetMarket: "Australian builders", proposedPricing: null, budgetAud: 500, userEvidence: null, relevantExperience: null, notes: null, track: null,
    });
    expect(opportunity.code).toBe("AVI-026");
    expect(opportunity.stage).toBe("idea");
    // read back through a fresh query (what a page refresh does)
    const [row] = await sql`select * from opportunities where id = ${opportunity.id}`;
    expect(row.name).toBe("Supplier price-increase detector");
    expect(Number(row.budgetAud)).toBe(500);
    const [log] = await sql`select * from audit_log where entity_id = ${opportunity.id} and action = 'created'`;
    expect(log).toBeTruthy();
  });

  it("flags similar ideas already in the database", async () => {
    const { similar, opportunity } = await repo.createOpportunity({
      name: "Supplier price increase detection for builders", description: "Detect supplier price increases on invoices",
      targetMarket: null, proposedPricing: null, budgetAud: null, userEvidence: null, relevantExperience: null, notes: null, track: null,
    });
    expect(similar[0]?.code).toBe("AVI-026");
    expect(opportunity.code).toBe("AVI-027");
  });
});

describe("scoring persistence", () => {
  it("saves scores, versions them, and records decision history", async () => {
    const [o] = await sql`select id from opportunities where code = 'AVI-026'`;
    const r1 = await repo.saveScore(o.id, crit([9, 9, 8, 8, 8, 8]), gates());
    expect(r1.result.decision).toBe("PASS");
    const r2 = await repo.saveScore(o.id, crit([9, 9, 8, 8, 8, 8], "estimate"), gates("satisfied", "estimate"));
    expect(r2.result.decision).toBe("INVESTIGATE");
    const rows = await sql`select decision, is_current from scores where opportunity_id = ${o.id} order by created_at`;
    expect(rows.map((r) => [r.decision, r.isCurrent])).toEqual([["PASS", false], ["INVESTIGATE", true]]);
    const hist = await sql`select * from decision_history where opportunity_id = ${o.id}`;
    expect(hist.length).toBe(2);
  });

  it("new weights create a version and rescoring keeps history", async () => {
    await repo.createScoringVersion("Test v2", { earnings: 50, demand: 10, acquisition: 10, ai_leverage: 10, operational_burden: 10, capital_risk: 10 },
      { pass: 80, investigate: 60, minEvidenceConfidence: 0.65 });
    const out = await repo.rescoreAll();
    expect(out.rescored).toBe(1);
    const [cur] = await sql`select s.weighted_total, v.label from scores s join scoring_versions v on v.id = s.scoring_version_id
      join opportunities o on o.id = s.opportunity_id where o.code = 'AVI-026' and s.is_current`;
    // 9×50 + 9×10 + 8×10×4 = 450 + 90 + 320 = 860 → 86
    expect(Number(cur.weightedTotal)).toBe(86);
    expect(cur.label).toBe("Test v2");
    await expect(repo.createScoringVersion("bad", { earnings: 50, demand: 10, acquisition: 10, ai_leverage: 10, operational_burden: 10, capital_risk: 5 },
      { pass: 80, investigate: 60, minEvidenceConfidence: 0.65 })).rejects.toThrow(/total 100/);
  });
});

describe("editing, merging, reopening (acceptance test 9)", () => {
  it("edits are saved with an audit trail of what changed", async () => {
    const [o] = await sql`select id from opportunities where code = 'AVI-027'`;
    await repo.updateOpportunity(o.id, { targetCustomer: "Builders with 10+ staff", nextReviewDate: "2026-12-01" });
    const [row] = await sql`select target_customer from opportunities where id = ${o.id}`;
    expect(row.targetCustomer).toBe("Builders with 10+ staff");
    const [log] = await sql`select changes from audit_log where entity_id = ${o.id} and action = 'updated'`;
    expect(log.changes.targetCustomer).toEqual({ from: null, to: "Builders with 10+ staff" });
  });
  it("merge archives without deleting, reopen restores", async () => {
    const [a] = await sql`select id from opportunities where code = 'AVI-027'`;
    const [b] = await sql`select id from opportunities where code = 'AVI-026'`;
    await repo.mergeOpportunities(a.id, b.id, "Same idea");
    const [m] = await sql`select stage, merged_into_id from opportunities where id = ${a.id}`;
    expect(m.stage).toBe("archive");
    expect(m.mergedIntoId).toBe(b.id);
    await repo.reopenOpportunity(a.id, "Distinct after all");
    const [r] = await sql`select stage, merged_into_id from opportunities where id = ${a.id}`;
    expect(r).toEqual({ stage: "investigate", mergedIntoId: null });
  });
});

describe("financial model persistence", () => {
  it("round-trips inputs and scenarios", async () => {
    const [o] = await sql`select id from opportunities where code = 'AVI-026'`;
    const { DEFAULT_INPUTS, DEFAULT_SCENARIOS } = await import("@/lib/finance");
    await repo.saveFinancialModel(o.id, { ...DEFAULT_INPUTS, price: 199, newCustomersPerMonth: 5 }, DEFAULT_SCENARIOS);
    const fm = await repo.getFinancialModel(o.id);
    expect(fm.saved).toBe(true);
    expect(fm.inputs.price).toBe(199);
    const list = await repo.listOpportunities();
    expect(list.find((x) => x.code === "AVI-026")?.baseOwnerEarningsY2).not.toBeNull();
  });
});

describe("import (acceptance tests 7, 8)", () => {
  it("rejects unsafe uploads", () => {
    expect(checkUpload("x.xlsm", new Uint8Array([0x50, 0x4b]))).toMatch(/Only .xlsx/);
    expect(checkUpload("x.xlsx", new TextEncoder().encode("<html>"))).toMatch(/not a valid/);
  });

  it("imports without data loss and links only explicit evidence", async () => {
    const bytes = await makeRegisterWorkbook();
    const plan = await planImport(sql, bytes);
    expect(plan.opportunities.map((o) => [o.code, o.status])).toEqual([["AVI-001", "new"], ["AVI-002", "new"], ["AVI-003", "new"]]);
    expect(plan.skippedExamples.length).toBe(1);
    expect(plan.warnings.join(" ")).toMatch(/E09/); // dangling reference reported
    expect(plan.warnings.join(" ")).toMatch(/E03 is not referenced/);
    const summary = await commitImport(sql, plan, "fixture.xlsx");
    expect(summary.opportunitiesCreated).toBe(3);
    const [a] = await sql`select * from opportunities where code = 'AVI-001'`;
    expect(a.name).toBe("Alpha document automation");
    expect(a.legacyRank).toBe(1);
    expect(Number(a.legacyScore)).toBe(88);
    expect(a.stage).toBe("investigate");
    expect(a.importRaw["Custom column"]).toBe("keep me"); // unknown columns preserved
    expect(a.importRaw["Initial score /100"]).toBe(88);
    const [legacy] = await sql`select s.decision, s.weighted_total, v.is_legacy from scores s join scoring_versions v on v.id = s.scoring_version_id where s.opportunity_id = ${a.id}`;
    expect(legacy).toEqual({ decision: "LEGACY", weightedTotal: 88, isLegacy: true });
    // no new-model score invented
    expect((await sql`select 1 from scores where opportunity_id = ${a.id} and decision <> 'LEGACY'`).length).toBe(0);
    // evidence: none treated as verified; unsafe URL dropped
    const ev = await sql`select code, classification, source_url from evidence order by code`;
    expect(ev.map((e) => e.classification)).toEqual(["unsupported", "unsupported", "unsupported"]);
    expect(ev[1].sourceUrl).toBeNull();
    const links = await sql`select o.code, e.code as ev from opportunity_evidence oe join opportunities o on o.id = oe.opportunity_id join evidence e on e.id = oe.evidence_id order by 1, 2`;
    expect(links.map((l) => `${l.code}:${l.ev}`)).toEqual(["AVI-001:E01", "AVI-001:E02", "AVI-002:E02"]);
    const [exp] = await sql`select o.code from experiments x join opportunities o on o.id = x.opportunity_id`;
    expect(exp.code).toBe("AVI-001");
  });

  it("re-importing the same file creates no duplicates", async () => {
    const before = await sql`select (select count(*) from opportunities)::int o, (select count(*) from evidence)::int e,
      (select count(*) from experiments)::int x, (select count(*) from decision_history)::int d, (select count(*) from opportunity_evidence)::int l`;
    const plan = await planImport(sql, await makeRegisterWorkbook());
    expect(plan.opportunities.every((o) => o.status === "duplicate")).toBe(true);
    const s = await commitImport(sql, plan, "fixture.xlsx");
    expect(s.opportunitiesCreated).toBe(0);
    const after = await sql`select (select count(*) from opportunities)::int o, (select count(*) from evidence)::int e,
      (select count(*) from experiments)::int x, (select count(*) from decision_history)::int d, (select count(*) from opportunity_evidence)::int l`;
    expect(after).toEqual(before);
  });

  it("new ideas after import continue from the next free code", async () => {
    const { opportunity } = await repo.createOpportunity({ name: "Another idea", description: null, targetMarket: null, proposedPricing: null,
      budgetAud: null, userEvidence: null, relevantExperience: null, notes: null, track: null });
    expect(opportunity.code).toBe("AVI-028");
  });
});

describe("export (acceptance test 10)", () => {
  it("exports xlsx, csv and json containing every opportunity", async () => {
    const count = (await sql`select count(*)::int as n from opportunities`)[0].n;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildWorkbook()) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Opportunities", "Scores", "Financial Models", "Evidence", "Experiments", "Decision History", "Scoring Versions", "Audit Log"]);
    expect(wb.getWorksheet("Opportunities")!.rowCount).toBe(count + 1);
    const csv = await buildCsv();
    expect(csv.trim().split("\r\n").length).toBe(count + 1);
    const backup = await buildBackup();
    expect((backup.opportunities as unknown[]).length).toBe(count);
  });
  it("neutralises formula injection in CSV", async () => {
    const [o] = await sql`select id from opportunities where code = 'AVI-028'`;
    await repo.updateOpportunity(o.id, { notes: "=HYPERLINK(\"http://evil\")" });
    expect(await buildCsv()).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});

const REAL = "local-data/register.xlsx";
describe.runIf(existsSync(REAL))("owner's real register workbook", () => {
  it("imports all 25 opportunities and 10 evidence items, then re-import adds nothing", async () => {
    await resetTestDb();
    const bytes = new Uint8Array(readFileSync(REAL));
    const plan = await planImport(sql, bytes);
    expect(plan.opportunities.length).toBe(25);
    expect(plan.opportunities.map((o) => o.rank)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(plan.evidence.length).toBe(10);
    expect(plan.experiments.length).toBe(5);
    const s = await commitImport(sql, plan, "register.xlsx");
    expect(s.opportunitiesCreated).toBe(25);
    const again = await planImport(sql, bytes);
    expect(again.previousImportOfSameFile).not.toBeNull();
    expect(again.opportunities.every((o) => o.status === "duplicate")).toBe(true);
    expect((await commitImport(sql, again, "register.xlsx")).opportunitiesCreated).toBe(0);
    expect((await sql`select count(*)::int n from opportunities`)[0].n).toBe(25);
    // spot-check: every original column value is preserved
    const [r2] = await sql`select * from opportunities where legacy_rank = 2`;
    expect(r2.name).toBe("Bookkeeping exception-management software");
    expect(Number(r2.legacyScore)).toBe(87);
    expect(Object.keys(r2.importRaw).length).toBe(23);
  });
});

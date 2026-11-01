import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resetTestDb, TEST_DATABASE_URL } from "../helpers/db";
import { makeRegisterWorkbook, makeRegisterWorkbookV12 } from "../helpers/fixture";

process.env.DATABASE_URL = TEST_DATABASE_URL;
const { getSql, ready } = await import("@/lib/db");
const { planImport, commitImport } = await import("@/lib/importer");
const { planBriefImport, commitBriefImport } = await import("@/lib/briefImport");
const { parseBrief } = await import("@/lib/researchBrief");
const repo = await import("@/lib/repo");
const sql = getSql();
const sample = readFileSync("tests/fixtures/brief-sample.md", "utf8");

describe("research brief import (same-idea wedge)", () => {
  beforeAll(async () => {
    await resetTestDb();
    await commitImport(sql, await planImport(sql, await makeRegisterWorkbook()), "reg.xlsx");
  });

  it("parses the brief", () => {
    const p = parseBrief(sample);
    expect(p.opportunityCode).toBe("AVI-001");
    expect(p.wedgeScores).toEqual({ earnings: 6, demand: 6, acquisition: 6, ai_leverage: 6, operational_burden: 6, capital_risk: 6 });
    expect(p.evidence.map((e) => [e.code, e.classification])).toEqual([["E201", "credible_secondary"], ["E202", "inference"]]);
    expect(p.childProposal).toBeNull();
  });

  it("previews, then scores the idea with labelled AI evidence — never PASS", async () => {
    const plan = await planBriefImport(sql, sample);
    expect(plan.parent?.code).toBe("AVI-001");
    expect(plan.parentScore?.result.weightedTotal).toBe(60);
    expect(plan.parentScore?.result.decision).toBe("INVESTIGATE");
    const s = await commitBriefImport(sql, sample, { createChild: false });
    expect(s).toMatchObject({ evidenceCreated: 2, scored: ["AVI-001"], childCode: null });
    const [cur] = await sql`select s.source, s.decision, s.gates from scores s join opportunities o on o.id = s.opportunity_id
      where o.code = 'AVI-001' and s.is_current and s.decision <> 'LEGACY'`;
    expect(cur.source).toMatch(/Research brief AVI-001 v1.0 · Grok/);
    expect(cur.gates.every((g: { status: string }) => g.status === "unknown")).toBe(true);
    const [ev] = await sql`select classification, source_note, source_url from evidence where code = 'E201'`;
    expect(ev.classification).toBe("credible_secondary");
    expect(ev.sourceNote).toMatch(/AI research/);
    expect(ev.sourceUrl).toBe("https://example.com/brokers");
    const d = await repo.getOpportunity((await sql`select id from opportunities where code = 'AVI-001'`)[0].id);
    expect(d?.briefs.length).toBe(1);
  });

  it("refuses the same brief twice and reports it in preview", async () => {
    const plan = await planBriefImport(sql, sample);
    expect(plan.alreadyImported).not.toBeNull();
    await expect(commitBriefImport(sql, sample, { createChild: false })).rejects.toThrow(/already been imported/);
  });

  it("rejects text that isn't a brief", async () => {
    await expect(planBriefImport(sql, "# Shopping list\n- milk")).rejects.toThrow(/research brief/);
  });

  it("automatic migrations are idempotent", async () => {
    await ready();
    const rows = await sql`select name from schema_migrations order by name`;
    expect(rows.map((r) => r.name)).toEqual(["001_init.sql", "002_research_briefs.sql", "003_workbook_v14.sql"]);
  });
});

const REAL = "local-data/AVI-026_research_brief_v1.0.md";
describe.runIf(existsSync(REAL))("owner's AVI-026 brief (Grok)", () => {
  beforeAll(async () => {
    await resetTestDb();
    await commitImport(sql, await planImport(sql, await makeRegisterWorkbookV12()), "v12.xlsx");
  });
  it("parks the generic idea at 37 and creates child AVI-032 at 52.5", async () => {
    const text = readFileSync(REAL, "utf8");
    const plan = await planBriefImport(sql, text);
    expect(plan.parentScore?.result.weightedTotal).toBe(37);
    expect(plan.child).toMatchObject({ code: "AVI-032", exists: null });
    expect(plan.child?.score?.result.weightedTotal).toBe(52.5);
    expect(plan.evidence.length).toBe(22);
    const s = await commitBriefImport(sql, text, { createChild: true });
    expect(s.childCode).toBe("AVI-032");
    expect(s.evidenceCreated).toBe(22);
    const rows = await sql`select o.code, s.weighted_total, s.decision from scores s join opportunities o on o.id = s.opportunity_id
      where s.is_current and s.decision <> 'LEGACY' order by o.code`;
    expect(rows.map((r) => [r.code, Number(r.weightedTotal), r.decision])).toEqual([["AVI-026", 37, "FAIL"], ["AVI-032", 52.5, "FAIL"]]);
    const [child] = await sql`select id, description, stage from opportunities where code = 'AVI-032'`;
    expect(child.description).toMatch(/Unbilled Job Sweep/);
    const d = await repo.getOpportunity(child.id);
    expect(d?.briefs.length).toBe(1);
    expect(d?.evidence.length).toBe(22);
    const next = await repo.createOpportunity({ name: "Totally new idea", description: null, targetMarket: null, proposedPricing: null,
      budgetAud: null, userEvidence: null, relevantExperience: null, notes: null, track: null });
    expect(next.opportunity.code).toBe("AVI-033");
  });
});

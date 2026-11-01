import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resetTestDb, TEST_DATABASE_URL } from "../helpers/db";
import { makeRegisterWorkbook, makeRegisterWorkbookV12 } from "../helpers/fixture";

process.env.DATABASE_URL = TEST_DATABASE_URL;
const { getSql } = await import("@/lib/db");
const repo = await import("@/lib/repo");
const { planImport, commitImport } = await import("@/lib/importer");
const sql = getSql();

describe("v1.2 sheets: Idea Intake, Evaluations, Validation Tests, brief", () => {
  beforeAll(resetTestDb);

  it("imports the intake idea with its evaluation, brief, test and decision", async () => {
    const plan = await planImport(sql, await makeRegisterWorkbookV12());
    const intake = plan.opportunities.find((o) => o.sourceId === "AVI-026")!;
    expect(intake).toMatchObject({ code: "AVI-026", status: "new" });
    expect(plan.warnings.join(" ")).not.toMatch(/isn't mapped/);
    const s = await commitImport(sql, plan, "v12.xlsx");
    expect(s.opportunitiesCreated).toBe(4);
    const [o] = await sql`select * from opportunities where code = 'AVI-026'`;
    expect(o.targetCustomer).toBe("Small service firms");
    expect(o.description).toBe("Niche automation setup + managed maintenance");
    expect(o.primaryRisks).toMatch(/Support burden/);
    expect(o.nextAction).toBe("8 interviews, 2 pilots");
    expect(o.stage).toBe("investigate");
    expect(o.notes).toMatch(/AI Implementation Brief/);
    expect(o.importRaw.brief["Working model"]).toMatch(/Niche/);
    const [x] = await sql`select e.code, o.code as opp from experiments e join opportunities o on o.id = e.opportunity_id where e.code = 'TEST-001'`;
    expect(x.opp).toBe("AVI-026");
    const [d] = await sql`select o.code from decision_history d join opportunities o on o.id = d.opportunity_id where d.new_decision = 'INVESTIGATE'`;
    expect(d.code).toBe("AVI-026");
    // no new-model score invented
    expect((await sql`select 1 from scores where opportunity_id = ${o.id}`).length).toBe(0);
  });

  it("re-importing v1.2 adds nothing", async () => {
    const s = await commitImport(sql, await planImport(sql, await makeRegisterWorkbookV12()), "v12.xlsx");
    expect(s).toMatchObject({ opportunitiesCreated: 0, experimentsCreated: 0, decisionsCreated: 0 });
  });
});

describe("upgrading from v1.1 to v1.2", () => {
  beforeAll(resetTestDb);
  it("adds only the new idea and attaches its decision row", async () => {
    await commitImport(sql, await planImport(sql, await makeRegisterWorkbook()), "v11.xlsx");
    const s = await commitImport(sql, await planImport(sql, await makeRegisterWorkbookV12()), "v12.xlsx");
    expect(s.opportunitiesCreated).toBe(1);
    expect((await sql`select count(*)::int n from opportunities`)[0].n).toBe(4);
    const next = await repo.createOpportunity({ name: "Something else entirely", description: null, targetMarket: null, proposedPricing: null,
      budgetAud: null, userEvidence: null, relevantExperience: null, notes: null, track: null });
    expect(next.opportunity.code).toBe("AVI-027");
  });
});

describe("idea entered by hand before importing v1.2", () => {
  beforeAll(resetTestDb);
  it("treats the hand-entered AVI-026 as the same idea", async () => {
    await commitImport(sql, await planImport(sql, await makeRegisterWorkbook()), "v11.xlsx");
    const { opportunity } = await repo.createOpportunity({ name: "Productised AI implementation for Australian service SMEs", description: null,
      targetMarket: null, proposedPricing: null, budgetAud: null, userEvidence: null, relevantExperience: null, notes: null, track: null });
    expect(opportunity.code).toBe("AVI-026");
    const plan = await planImport(sql, await makeRegisterWorkbookV12());
    expect(plan.opportunities.find((o) => o.sourceId === "AVI-026")).toMatchObject({ status: "duplicate", duplicateOf: "AVI-026" });
    const s = await commitImport(sql, plan, "v12.xlsx");
    expect(s.opportunitiesCreated).toBe(0);
    const [x] = await sql`select o.code from experiments e join opportunities o on o.id = e.opportunity_id where e.code = 'TEST-001'`;
    expect(x.code).toBe("AVI-026");
  });
});

const REAL = "local-data/v12.xlsx";
describe.runIf(existsSync(REAL))("owner's real v1.2 workbook", () => {
  beforeAll(resetTestDb);
  it("imports 26 opportunities with no unmapped-sheet warnings", async () => {
    const plan = await planImport(sql, new Uint8Array(readFileSync(REAL)));
    expect(plan.opportunities.length).toBe(26);
    expect(plan.warnings.join(" ")).not.toMatch(/isn't mapped|no matching/);
    const s = await commitImport(sql, plan, "v12.xlsx");
    expect(s.opportunitiesCreated).toBe(26);
    expect(s.experimentsCreated).toBe(6);
    const [o] = await sql`select name, description, next_review_date from opportunities where code = 'AVI-026'`;
    expect(o.name).toBe("Productised AI implementation for Australian service SMEs");
    expect(o.description).toMatch(/Niche-specific automation/);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resetTestDb, TEST_DATABASE_URL } from "../helpers/db";

process.env.DATABASE_URL = TEST_DATABASE_URL;
const { getSql } = await import("@/lib/db");
const repo = await import("@/lib/repo");
const { planImport, commitImport, expandIds } = await import("@/lib/importer");
const { commitBriefImport } = await import("@/lib/briefImport");
const sql = getSql();

describe("evidence ID ranges", () => {
  it("expands en-dash ranges and keeps padding", () => {
    expect(expandIds("E01; E02; E11–E14")).toEqual(["E01", "E02", "E11", "E12", "E13", "E14"]);
    expect(expandIds("E97 - E99, E112")).toEqual(["E97", "E98", "E99", "E112"]);
    expect(expandIds(null)).toEqual([]);
  });
});

const V11 = "local-data/register.xlsx";
const V14 = "local-data/v14.xlsx";
const BRIEF = "local-data/AVI-026_research_brief_v1.0.md";
const real = existsSync(V11) && existsSync(V14) && existsSync(BRIEF);

describe.runIf(existsSync(V14))("owner's v1.4 workbook into an empty AVI", () => {
  beforeAll(resetTestDb);
  it("imports all 27 ideas with codes, evidence, competitors and links", async () => {
    const plan = await planImport(sql, new Uint8Array(readFileSync(V14)));
    expect(plan.fileVersion).toBe("v1.4");
    expect(plan.opportunities.map((o) => o.code)).toContain("AVI-032");
    expect(plan.opportunities.length).toBe(27);
    expect(plan.sheetsIgnored.join(" ")).toMatch(/Validation Tests \(marked deprecated/);
    expect(plan.evidence.filter((e) => e.classification === "credible_secondary").length).toBe(42);
    expect(plan.evidence.some((e) => e.classification === "verified")).toBe(false);
    const s = await commitImport(sql, plan, "v14.xlsx");
    expect(s.opportunitiesCreated).toBe(27);
    expect(s.evidenceCreated).toBe(114);
    expect(s.competitors).toBe(71);
    expect(s.nicheScans).toBe(20);
    expect(s.experimentsCreated).toBe(12);
    const [o1] = await sql`select id, niche, stage from opportunities where code = 'AVI-001'`;
    expect(o1.niche.wedge).toMatch(/Self-employed|SE income pack/i);
    const n1 = (await sql`select count(*)::int n from opportunity_evidence where opportunity_id = ${o1.id}`)[0].n;
    expect(n1).toBe(16); // E01–E03 + E11–E23
    const [k] = await sql`select o.code, o.parent_code, o.stage from opportunities o where code = 'AVI-032'`;
    expect(k).toMatchObject({ parentCode: "AVI-026", stage: "investigate" });
    const [x] = await sql`select o.code from experiments e join opportunities o on o.id = e.opportunity_id where e.code = 'EXP-006r1'`;
    expect(x.code).toBe("AVI-032");
    // workbook evaluation scores imported, labelled
    const [sc] = await sql`select s.weighted_total, s.source from scores s join opportunities o on o.id = s.opportunity_id
      where o.code = 'AVI-032' and s.is_current and s.decision <> 'LEGACY'`;
    expect(Number(sc.weightedTotal)).toBe(52.5);
    expect(sc.source).toMatch(/Workbook Idea Evaluations \(v1.4\)/);
    expect(plan.briefsNeeded.map((b) => b.code)).toEqual(["AVI-001", "AVI-002", "AVI-003", "AVI-004", "AVI-005", "AVI-026"]);
    // second import changes nothing
    const again = await planImport(sql, new Uint8Array(readFileSync(V14)));
    expect(again.opportunities.every((o) => o.status === "duplicate" && o.changes.length === 0)).toBe(true);
    expect(again.scores.every((x) => x.status === "same")).toBe(true);
    const s2 = await commitImport(sql, again, "v14.xlsx");
    expect(s2).toMatchObject({ opportunitiesCreated: 0, opportunitiesUpdated: 0, evidenceCreated: 0, evidenceUpdated: 0, competitors: 0, scored: [] });
  });
});

describe.runIf(real)("upgrading v1.1 + AVI-026 brief → v1.4", () => {
  beforeAll(resetTestDb);
  it("updates in place, keeps owner edits, and adds no duplicates", async () => {
    await commitImport(sql, await planImport(sql, new Uint8Array(readFileSync(V11))), "v11.xlsx");
    // owner edits one field in AVI and reclassifies one evidence item
    const [o2] = await sql`select id from opportunities where code = 'AVI-002'`;
    await repo.updateOpportunity(o2.id, { nextAction: "My own next step" });
    const [e01] = await sql`select id from evidence where code = 'E01'`;
    await repo.classifyEvidence(e01.id, "inference");

    const plan = await planImport(sql, new Uint8Array(readFileSync(V14)));
    expect(plan.opportunities.filter((o) => o.status === "new").map((o) => o.code).sort()).toEqual(["AVI-026", "AVI-032"]);
    const p2 = plan.opportunities.find((o) => o.duplicateOf === "AVI-002")!;
    expect(p2.conflicts.map((c) => c.field)).toEqual(["nextAction"]);
    expect(p2.changes.map((c) => c.field)).toContain("notes");
    const s = await commitImport(sql, plan, "v14.xlsx");
    expect(s.opportunitiesCreated).toBe(2);
    expect(s.opportunitiesUpdated).toBeGreaterThanOrEqual(5);
    expect((await sql`select count(*)::int n from opportunities`)[0].n).toBe(27);
    const [after] = await sql`select next_action, stage, niche, notes from opportunities where code = 'AVI-002'`;
    expect(after.nextAction).toBe("My own next step");
    expect(after.notes).toMatch(/v1.4 research/);
    expect(after.niche).not.toBeNull();
    const [h] = await sql`select o.stage from opportunities o where code = 'AVI-006'`;
    expect(h.stage).toBe("hold");
    expect((await sql`select classification from evidence where code = 'E01'`)[0].classification).toBe("inference");

    // the AVI-026 brief then attaches to the imported idea and does not clash with its evidence
    const r = await commitBriefImport(sql, readFileSync(BRIEF, "utf8"), { createChild: true });
    expect(r.childCode).toBe("AVI-032");
    expect((await sql`select count(*)::int n from opportunities`)[0].n).toBe(27);
  });
});

describe.runIf(real)("brief first, then v1.4", () => {
  beforeAll(resetTestDb);
  it("merges the brief's child idea and evidence instead of duplicating them", async () => {
    await commitImport(sql, await planImport(sql, new Uint8Array(readFileSync("local-data/v12.xlsx"))), "v12.xlsx");
    await commitBriefImport(sql, readFileSync(BRIEF, "utf8"), { createChild: true });
    const plan = await planImport(sql, new Uint8Array(readFileSync(V14)));
    expect(plan.opportunities.filter((o) => o.status === "new")).toEqual([]);
    expect(plan.evidence.find((e) => e.code === "E99")?.status).toBe("duplicate");
    const s = await commitImport(sql, plan, "v14.xlsx");
    expect(s.opportunitiesCreated).toBe(0);
    expect((await sql`select count(*)::int n from opportunities`)[0].n).toBe(27);
    expect((await sql`select count(*)::int n from evidence`)[0].n).toBe(114);
    const [t] = await sql`select status from experiments where code = 'TEST-001'`;
    expect(t.status).toBe("superseded by EXP-006");
    const [a26] = await sql`select stage from opportunities where code = 'AVI-026'`;
    expect(a26.stage).toBe("hold");
    expect(plan.scores.find((x) => x.code === "AVI-032")?.status).toBe("same");
  });
});

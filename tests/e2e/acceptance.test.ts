// Runs the brief's 10 Phase 1 acceptance tests over HTTP against a running app.
// Usage: AVI_BASE_URL=http://localhost:3000 AVI_OWNER_PASSWORD=... npm run test:e2e
// Use a disposable database — this creates records.
import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { makeRegisterWorkbook } from "../helpers/fixture";

const BASE = process.env.AVI_BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.AVI_OWNER_PASSWORD ?? "";
let cookie = "";
const run = Date.now().toString(36);

async function call(path: string, init: RequestInit = {}) {
  return fetch(BASE + path, { ...init, redirect: "manual", headers: { ...(init.headers ?? {}), cookie } });
}
async function json(path: string, method: string, body?: unknown) {
  const res = await call(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function upload(bytes: Uint8Array, mode: "preview" | "commit", name = "register.xlsx") {
  const fd = new FormData();
  fd.append("file", new Blob([bytes as BlobPart]), name);
  fd.append("mode", mode);
  const res = await call("/api/import", { method: "POST", body: fd });
  return { status: res.status, body: await res.json() };
}
const crit = (s: number[], evidence = "verified") =>
  ["earnings", "demand", "acquisition", "ai_leverage", "operational_burden", "capital_risk"].map((key, i) => ({ key, score: s[i], evidence, rationale: "" }));
const gates = (status = "satisfied", evidence = "verified") =>
  ["willingness_to_pay", "unit_economics", "acquisition", "delivery", "legal"].map((key) => ({ key, status, evidence, note: "" }));

let ideaId = "";

beforeAll(async () => {
  const health = await fetch(BASE + "/api/health");
  expect(health.status).toBe(200);
  const res = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) });
  expect(res.status).toBe(200);
  cookie = res.headers.get("set-cookie")!.split(";")[0];
});

describe("security basics", () => {
  it("rejects requests without a session", async () => {
    expect((await fetch(BASE + "/api/opportunities")).status).toBe(401);
    expect((await fetch(BASE + "/", { redirect: "manual" })).status).toBe(307);
  });
  it("rejects a wrong password", async () => {
    const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "nope" }) });
    expect(r.status).toBe(401);
  });
  it("blocks cross-site writes", async () => {
    const r = await call("/api/opportunities", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(403);
  });
  it("validates input", async () => {
    const r = await json("/api/opportunities", "POST", { name: "x" });
    expect(r.status).toBe(400);
  });
});

describe("Phase 1 acceptance tests", () => {
  it("1. a new idea can be submitted and saved", async () => {
    const r = await json("/api/opportunities", "POST", { name: `Supplier price-increase detector ${run}`, description: "AI software that identifies unexplained supplier price increases for Australian construction companies.", budgetAud: "500" });
    expect(r.status).toBe(201);
    expect(r.body.opportunity.code).toMatch(/^AVI-\d{3}$/);
    ideaId = r.body.opportunity.id;
  });

  it("2. the idea remains after refreshing / reopening", async () => {
    const page = await call(`/opportunities/${ideaId}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`Supplier price-increase detector ${run}`);
    const list = await json("/api/opportunities", "GET");
    expect(list.body.some((o: { id: string }) => o.id === ideaId)).toBe(true);
  });

  it("3. the same scores always produce the same weighted result", async () => {
    const totals = new Set<number>();
    for (let i = 0; i < 5; i++) totals.add((await json(`/api/opportunities/${ideaId}/score`, "POST", { criteria: crit([7.3, 6.1, 8.8, 4.4, 9.9, 0.7]), gates: gates() })).body.weightedTotal);
    // 7.3×35+6.1×20+8.8×15+4.4×15+9.9×10+0.7×5 = 255.5+122+132+66+99+3.5 = 678 → 67.8
    expect([...totals]).toEqual([67.8]);
  });

  it("4. insufficient evidence prevents an unsupported PASS", async () => {
    const strong = await json(`/api/opportunities/${ideaId}/score`, "POST", { criteria: crit([9, 9, 8, 8, 8, 8]), gates: gates() });
    expect(strong.body.decision).toBe("PASS");
    const weak = await json(`/api/opportunities/${ideaId}/score`, "POST", { criteria: crit([9, 9, 8, 8, 8, 8], "estimate"), gates: gates("satisfied", "estimate") });
    expect(weak.body.weightedTotal).toBe(85.5);
    expect(weak.body.decision).toBe("INVESTIGATE");
  });

  it("5. a critical blocker produces FAIL", async () => {
    const g = gates();
    g[4].status = "blocker";
    const r = await json(`/api/opportunities/${ideaId}/score`, "POST", { criteria: crit([10, 10, 10, 10, 10, 10]), gates: g });
    expect(r.body.weightedTotal).toBe(100);
    expect(r.body.decision).toBe("FAIL");
  });

  it("6. financial calculations are accurate (and saved)", async () => {
    const inputs = { currency: "AUD", revenueModel: "one_off", price: 100, startingCustomers: 0, newCustomersPerMonth: 10, monthlyChurnPct: 0,
      conversionRatePct: 2, cac: 20, grossMarginPct: 80, hostingAiPerCustomerMonthly: 5, fixedMonthlyCosts: 300, contractorMonthly: 0,
      startupInvestment: 1000, ownerHoursPerWeek: 10, companyTaxRatePct: 25, horizonMonths: 24 };
    const scen = { conservative: { price: 1, newCustomers: 1, churn: 1, cac: 1, costs: 1 }, base: { price: 1, newCustomers: 1, churn: 1, cac: 1, costs: 1 }, optimistic: { price: 1, newCustomers: 1, churn: 1, cac: 1, costs: 1 } };
    expect((await json(`/api/opportunities/${ideaId}/financial`, "POST", { inputs, scenarios: scen })).status).toBe(200);
    const list = (await json("/api/opportunities", "GET")).body;
    // profit/month = 10×100×0.8 − 10×5 − 300 − 10×20 = 250 → 3,000/year
    expect(list.find((o: { id: string }) => o.id === ideaId).baseOwnerEarningsY2).toBe(3000);
    expect((await json(`/api/opportunities/${ideaId}/financial`, "POST", { inputs: { ...inputs, grossMarginPct: 150 }, scenarios: scen })).status).toBe(400);
  });

  let importedCount = 0;
  it("7. existing opportunities import without data loss", async () => {
    const bytes = await makeRegisterWorkbook();
    const preview = await upload(bytes, "preview");
    expect(preview.status).toBe(200);
    const fresh = preview.body.plan.opportunities.filter((o: { status: string }) => o.status === "new").length;
    const commit = await upload(bytes, "commit");
    expect(commit.status).toBe(200);
    expect(commit.body.summary.opportunitiesCreated).toBe(fresh);
    const list = (await json("/api/opportunities", "GET")).body;
    const alpha = list.find((o: { name: string }) => o.name === "Alpha document automation");
    expect(alpha.legacyRank).toBe(1);
    expect(alpha.legacyScore).toBe(88);
    expect(alpha.importRaw["Custom column"]).toBe("keep me");
    expect(alpha.decision).toBe("UNSCORED"); // original rank not treated as validated
    importedCount = list.length;
  });

  it("8. duplicate imports do not create duplicate opportunities", async () => {
    const again = await upload(await makeRegisterWorkbook(), "commit");
    expect(again.body.summary.opportunitiesCreated).toBe(0);
    expect((await json("/api/opportunities", "GET")).body.length).toBe(importedCount);
    expect((await upload(new TextEncoder().encode("not a workbook"), "preview")).status).toBe(400);
    expect((await upload(await makeRegisterWorkbook(), "preview", "evil.xlsm")).status).toBe(400);
  });

  it("9. opportunities can be edited and compared", async () => {
    const r = await json(`/api/opportunities/${ideaId}`, "PATCH", { targetCustomer: "Mid-size builders", nextReviewDate: "2026-11-20" });
    expect(r.status).toBe(200);
    expect(r.body.targetCustomer).toBe("Mid-size builders");
    const list = (await json("/api/opportunities", "GET")).body;
    const other = list.find((o: { id: string }) => o.id !== ideaId).id;
    const page = await call(`/compare?ids=${ideaId},${other}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Ranked recommendation");
    expect(html).toContain("Supplier price-increase detector");
  });

  it("10. data can be exported", async () => {
    const x = await call("/api/export?format=xlsx");
    expect(x.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await x.arrayBuffer());
    expect(wb.getWorksheet("Opportunities")!.rowCount).toBe(importedCount + 1);
    const csv = await (await call("/api/export?format=csv")).text();
    expect(csv).toContain("Supplier price-increase detector");
    const backup = await (await call("/api/export?format=json")).json();
    expect(backup.opportunities.length).toBe(importedCount);
    expect(backup.audit_log.length).toBeGreaterThan(0);
  });

  it("every page renders for a signed-in user", async () => {
    for (const p of ["/", "/opportunities", "/opportunities/new", "/compare", "/evidence", "/import", "/settings", `/opportunities/${ideaId}`]) {
      const r = await call(p);
      expect(r.status, p).toBe(200);
    }
  });
});

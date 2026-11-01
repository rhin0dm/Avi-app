import "server-only";
import ExcelJS from "exceljs";
import { getSql, ready } from "./db";
import { listOpportunities } from "./repo";
import { runScenarios, financialInputsSchema, scenariosSchema } from "./finance";
import { CRITERIA, GATES } from "./scoring";

const TABLES = ["opportunities", "scoring_versions", "scores", "financial_models", "evidence", "opportunity_evidence",
  "experiments", "decision_history", "jobs", "audit_log", "settings", "import_runs", "research_briefs"] as const;

const plain = (v: unknown): string | number | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

function addSheet(wb: ExcelJS.Workbook, name: string, rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name);
  const cols = Array.from(rows.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set<string>()));
  ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(60, Math.max(12, c.length + 2)) }));
  for (const r of rows) ws.addRow(Object.fromEntries(cols.map((c) => [c, plain(r[c])])));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

export async function opportunityExportRows() {
  const opps = await listOpportunities({ includeMerged: true });
  return opps.map((o) => ({
    code: o.code, name: o.name, stage: o.stage, decision: o.decision, weightedScore: o.weightedTotal,
    evidenceConfidence: o.evidenceConfidence, scoringVersion: o.scoringVersionLabel ?? null, scoreStale: o.scoreStale ?? null,
    baseOwnerEarningsYear2Hypothetical: o.baseOwnerEarningsY2, track: o.track, targetCustomer: o.targetCustomer,
    problem: o.problem, description: o.description, coreHypothesis: o.coreHypothesis, businessModels: o.businessModels,
    revenueMechanisms: o.revenueMechanisms, assumptions: o.assumptions, customerContact: o.customerContact,
    targetMarket: o.targetMarket, proposedPricing: o.proposedPricing, budgetAud: o.budgetAud,
    testBudgetLowAud: o.testBudgetLowAud, testBudgetHighAud: o.testBudgetHighAud, primaryRisks: o.primaryRisks,
    competitorLeads: o.competitorLeads, nextAction: o.nextAction, nextReviewDate: o.nextReviewDate, owner: o.owner,
    revenueAssumptions: o.revenueAssumptions, actualTestSpendAud: o.actualTestSpendAud, verifiedRevenueAud: o.verifiedRevenueAud,
    notes: o.notes, userEvidence: o.userEvidence, relevantExperience: o.relevantExperience,
    legacyRank: o.legacyRank, legacyScore: o.legacyScore, legacyDecision: o.legacyDecision,
    legacyValidationStatus: o.legacyValidationStatus, legacyEvidenceStatus: o.legacyEvidenceStatus,
    mergedInto: o.mergedIntoCode, importSource: o.importSource, createdAt: o.createdAt, updatedAt: o.updatedAt, id: o.id,
  }));
}

export async function buildWorkbook(): Promise<Buffer> {
  const sql = getSql();
  const wb = new ExcelJS.Workbook();
  wb.creator = "AVI";
  wb.created = new Date();
  addSheet(wb, "Opportunities", await opportunityExportRows());

  const scores = await sql`select o.code, v.label as version, s.* from scores s join opportunities o on o.id = s.opportunity_id
    join scoring_versions v on v.id = s.scoring_version_id order by o.code, s.created_at`;
  addSheet(wb, "Scores", scores.map((s) => {
    const row: Record<string, unknown> = { code: s.code, version: s.version, current: s.isCurrent, decision: s.decision,
      weightedTotal: s.weightedTotal, evidenceConfidence: s.evidenceConfidence, scoredAt: s.createdAt };
    for (const c of CRITERIA) {
      const x = (s.criteria ?? []).find((k: { key: string }) => k.key === c.key);
      row[`${c.key}_score`] = x?.score ?? null;
      row[`${c.key}_evidence`] = x?.evidence ?? null;
    }
    for (const g of GATES) {
      const x = (s.gates ?? []).find((k: { key: string }) => k.key === g.key);
      row[`gate_${g.key}`] = x ? `${x.status} (${x.evidence})` : null;
    }
    row.reasons = (s.decisionReasons ?? []).join(" ");
    return row;
  }));

  const fms = await sql`select o.code, f.* from financial_models f join opportunities o on o.id = f.opportunity_id order by o.code`;
  addSheet(wb, "Financial Models", fms.flatMap((f) => {
    const sc = runScenarios(financialInputsSchema.parse(f.inputs), scenariosSchema.parse(f.scenarios));
    return (["conservative", "base", "optimistic"] as const).map((k) => ({
      code: f.code, scenario: k, note: "Hypothetical projection from assumptions — not verified earnings",
      ...f.inputs, year1Revenue: sc[k].annual[0]?.revenue, year1OperatingProfit: sc[k].annual[0]?.operatingProfit,
      year2Revenue: sc[k].annual[1]?.revenue, year2OwnerEarningsBeforePersonalTax: sc[k].ownerEarningsYear2,
      breakEvenMonth: sc[k].breakEvenMonth, peakCashRequired: sc[k].peakCashRequired, ltv: sc[k].ltv, ltvToCac: sc[k].ltvToCac,
    }));
  }));

  addSheet(wb, "Evidence", await sql`select e.*, (select string_agg(o.code, '; ') from opportunity_evidence oe
    join opportunities o on o.id = oe.opportunity_id where oe.evidence_id = e.id) as linked_opportunities from evidence e order by code`);
  addSheet(wb, "Experiments", await sql`select o.code as opportunity, e.* from experiments e left join opportunities o on o.id = e.opportunity_id order by e.code`);
  addSheet(wb, "Decision History", await sql`select o.code as opportunity, d.* from decision_history d left join opportunities o on o.id = d.opportunity_id order by d.created_at`);
  addSheet(wb, "Scoring Versions", await sql`select * from scoring_versions order by id`);
  addSheet(wb, "Audit Log", await sql`select * from audit_log order by at desc limit 20000`);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** CSV cell: quoted, with spreadsheet-formula prefixes neutralised. */
function csvCell(v: unknown): string {
  let s = plain(v);
  if (s === null) return "";
  s = String(s);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function buildCsv(): Promise<string> {
  const rows = await opportunityExportRows();
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell((r as Record<string, unknown>)[c])).join(","))].join("\r\n");
}

export async function buildBackup() {
  await ready();
  const sql = getSql();
  const out: Record<string, unknown> = { app: "AVI", format: 1, exportedAt: new Date().toISOString() };
  for (const t of TABLES) out[t] = await sql`select * from ${sql(t)}`;
  return out;
}

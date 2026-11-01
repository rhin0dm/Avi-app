// Deterministic monthly financial model. Every output is a hypothetical
// projection from user-entered assumptions, never verified earning potential.
import { z } from "zod";

export const financialInputsSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).default("AUD"),
  revenueModel: z.enum(["recurring", "one_off"]),
  price: z.number().min(0).max(10_000_000),
  startingCustomers: z.number().min(0).max(10_000_000).default(0),
  newCustomersPerMonth: z.number().min(0).max(1_000_000),
  monthlyChurnPct: z.number().min(0).max(100).default(0),
  conversionRatePct: z.number().min(0.01).max(100).default(2),
  cac: z.number().min(0).max(10_000_000),
  grossMarginPct: z.number().min(0).max(100),
  hostingAiPerCustomerMonthly: z.number().min(0).max(1_000_000).default(0),
  fixedMonthlyCosts: z.number().min(0).max(100_000_000).default(0),
  contractorMonthly: z.number().min(0).max(100_000_000).default(0),
  startupInvestment: z.number().min(0).max(100_000_000).default(0),
  ownerHoursPerWeek: z.number().min(0).max(100).default(0),
  companyTaxRatePct: z.number().min(0).max(60).default(25),
  horizonMonths: z.number().int().min(12).max(60).default(36),
});
export type FinancialInputs = z.infer<typeof financialInputsSchema>;

export const multipliersSchema = z.object({
  price: z.number().min(0).max(10),
  newCustomers: z.number().min(0).max(10),
  churn: z.number().min(0).max(10),
  cac: z.number().min(0).max(10),
  costs: z.number().min(0).max(10),
});
export type Multipliers = z.infer<typeof multipliersSchema>;
export const scenariosSchema = z.object({
  conservative: multipliersSchema,
  base: multipliersSchema,
  optimistic: multipliersSchema,
});
export type Scenarios = z.infer<typeof scenariosSchema>;

export const DEFAULT_SCENARIOS: Scenarios = {
  conservative: { price: 0.9, newCustomers: 0.6, churn: 1.5, cac: 1.3, costs: 1.15 },
  base: { price: 1, newCustomers: 1, churn: 1, cac: 1, costs: 1 },
  optimistic: { price: 1.1, newCustomers: 1.3, churn: 0.75, cac: 0.8, costs: 0.95 },
};

export const DEFAULT_INPUTS: FinancialInputs = {
  currency: "AUD", revenueModel: "recurring", price: 0, startingCustomers: 0, newCustomersPerMonth: 0,
  monthlyChurnPct: 3, conversionRatePct: 2, cac: 0, grossMarginPct: 85, hostingAiPerCustomerMonthly: 0,
  fixedMonthlyCosts: 0, contractorMonthly: 0, startupInvestment: 0, ownerHoursPerWeek: 0,
  companyTaxRatePct: 25, horizonMonths: 36,
};

export type MonthRow = {
  month: number; customers: number; newCustomers: number; revenue: number; grossProfit: number;
  acquisitionSpend: number; operatingCosts: number; operatingProfit: number; cumulativeCash: number;
};

export type ModelResult = {
  months: MonthRow[];
  monthlyRevenueM12: number;
  annual: { year: number; revenue: number; grossProfit: number; operatingProfit: number }[];
  ownerEarningsYear1: number; // before personal tax, owner draws no salary
  ownerEarningsYear2: number;
  ownerEarningsYear2AfterCompanyTax: number;
  breakEvenMonth: number | null; // first month with operating profit ≥ 0
  cashPaybackMonth: number | null; // first month cumulative cash ≥ 0 (recovers startup)
  peakCashRequired: number; // startup + worst cumulative deficit
  contributionPerCustomerMonth: number; // recurring: per customer per month; one-off: per sale
  ltv: number | null;
  ltvToCac: number | null;
  cacPaybackMonths: number | null;
  steadyStateCustomers: number | null;
  leadsNeededPerMonth: number;
  effectiveHourlyRateYear2: number | null;
  warnings: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function applyMultipliers(i: FinancialInputs, m: Multipliers): FinancialInputs {
  return {
    ...i,
    price: i.price * m.price,
    newCustomersPerMonth: i.newCustomersPerMonth * m.newCustomers,
    monthlyChurnPct: Math.min(100, i.monthlyChurnPct * m.churn),
    cac: i.cac * m.cac,
    hostingAiPerCustomerMonthly: i.hostingAiPerCustomerMonthly * m.costs,
    fixedMonthlyCosts: i.fixedMonthlyCosts * m.costs,
    contractorMonthly: i.contractorMonthly * m.costs,
  };
}

export function runModel(input: FinancialInputs): ModelResult {
  const i = financialInputsSchema.parse(input);
  const recurring = i.revenueModel === "recurring";
  const churn = recurring ? i.monthlyChurnPct / 100 : 0;
  const gm = i.grossMarginPct / 100;
  const months: MonthRow[] = [];
  let active = recurring ? i.startingCustomers : 0;
  let cumulative = -i.startupInvestment;
  let minCumulative = cumulative;

  for (let m = 1; m <= i.horizonMonths; m++) {
    const added = i.newCustomersPerMonth;
    let billable: number;
    if (recurring) {
      active = active * (1 - churn) + added;
      billable = active;
    } else {
      billable = added;
      active = added;
    }
    const revenue = billable * i.price;
    const grossProfit = revenue * gm - billable * i.hostingAiPerCustomerMonthly;
    const acquisitionSpend = added * i.cac;
    const operatingCosts = i.fixedMonthlyCosts + i.contractorMonthly + acquisitionSpend;
    const operatingProfit = grossProfit - operatingCosts;
    cumulative += operatingProfit;
    minCumulative = Math.min(minCumulative, cumulative);
    months.push({
      month: m, customers: active, newCustomers: added, revenue, grossProfit, acquisitionSpend,
      operatingCosts, operatingProfit, cumulativeCash: cumulative,
    });
  }

  const annual = [];
  for (let y = 0; y * 12 < i.horizonMonths; y++) {
    const slice = months.slice(y * 12, y * 12 + 12);
    annual.push({
      year: y + 1,
      revenue: r2(slice.reduce((s, x) => s + x.revenue, 0)),
      grossProfit: r2(slice.reduce((s, x) => s + x.grossProfit, 0)),
      operatingProfit: r2(slice.reduce((s, x) => s + x.operatingProfit, 0)),
    });
  }

  const contribution = i.price * gm - i.hostingAiPerCustomerMonthly;
  let ltv: number | null = null;
  let cacPaybackMonths: number | null = null;
  let steadyStateCustomers: number | null = null;
  if (recurring) {
    ltv = churn > 0 ? contribution / churn : null; // undefined lifetime when churn is 0
    cacPaybackMonths = contribution > 0 ? i.cac / contribution : null;
    steadyStateCustomers = churn > 0 ? i.newCustomersPerMonth / churn : null;
  } else {
    ltv = contribution;
    cacPaybackMonths = contribution > 0 ? (i.cac === 0 ? 0 : i.cac / contribution) : null;
  }
  const ltvToCac = ltv !== null && i.cac > 0 ? ltv / i.cac : null;

  const be = months.find((x) => x.operatingProfit >= 0);
  const payback = months.find((x) => x.cumulativeCash >= 0);
  const y1 = annual[0]?.operatingProfit ?? 0;
  const y2 = annual[1]?.operatingProfit ?? 0;

  const warnings: string[] = [];
  if (i.price === 0 || i.newCustomersPerMonth === 0) warnings.push("Price or customer volume is zero — the model has no revenue.");
  if (contribution <= 0) warnings.push("Each customer loses money before overheads (contribution ≤ 0).");
  if (ltvToCac !== null && ltvToCac < 3) warnings.push(`LTV:CAC is ${ltvToCac.toFixed(1)} — below the common 3:1 benchmark.`);
  if (cacPaybackMonths !== null && cacPaybackMonths > 12) warnings.push(`CAC payback is ${cacPaybackMonths.toFixed(1)} months — over a year.`);
  if (!be) warnings.push(`No operating break-even within ${i.horizonMonths} months.`);
  if (recurring && churn === 0) warnings.push("Churn of 0% is unrealistic; lifetime value is undefined.");

  return {
    months,
    monthlyRevenueM12: r2(months[11]?.revenue ?? 0),
    annual,
    ownerEarningsYear1: y1,
    ownerEarningsYear2: y2,
    ownerEarningsYear2AfterCompanyTax: r2(y2 > 0 ? y2 * (1 - i.companyTaxRatePct / 100) : y2),
    breakEvenMonth: be?.month ?? null,
    cashPaybackMonth: payback?.month ?? null,
    peakCashRequired: r2(Math.max(0, -minCumulative)),
    contributionPerCustomerMonth: r2(contribution),
    ltv: ltv === null ? null : r2(ltv),
    ltvToCac: ltvToCac === null ? null : Math.round(ltvToCac * 100) / 100,
    cacPaybackMonths: cacPaybackMonths === null ? null : Math.round(cacPaybackMonths * 10) / 10,
    steadyStateCustomers: steadyStateCustomers === null ? null : Math.round(steadyStateCustomers * 10) / 10,
    leadsNeededPerMonth: Math.ceil(i.newCustomersPerMonth / (i.conversionRatePct / 100)),
    effectiveHourlyRateYear2: i.ownerHoursPerWeek > 0 ? r2(y2 / (i.ownerHoursPerWeek * 52)) : null,
    warnings,
  };
}

export function runScenarios(inputs: FinancialInputs, scenarios: Scenarios = DEFAULT_SCENARIOS) {
  return {
    conservative: runModel(applyMultipliers(inputs, scenarios.conservative)),
    base: runModel(applyMultipliers(inputs, scenarios.base)),
    optimistic: runModel(applyMultipliers(inputs, scenarios.optimistic)),
  };
}

/** Year-2 operating profit when each driver moves ±20% on the base case. */
export function sensitivity(inputs: FinancialInputs, pct = 20) {
  const f = pct / 100;
  const base = runModel(inputs).ownerEarningsYear2;
  const drivers: { label: string; apply: (i: FinancialInputs, k: number) => FinancialInputs }[] = [
    { label: "Price", apply: (i, k) => ({ ...i, price: i.price * k }) },
    { label: "New customers / month", apply: (i, k) => ({ ...i, newCustomersPerMonth: i.newCustomersPerMonth * k }) },
    { label: "Monthly churn", apply: (i, k) => ({ ...i, monthlyChurnPct: Math.min(100, i.monthlyChurnPct * k) }) },
    { label: "Acquisition cost (CAC)", apply: (i, k) => ({ ...i, cac: i.cac * k }) },
    {
      label: "Operating & delivery costs",
      apply: (i, k) => ({
        ...i, fixedMonthlyCosts: i.fixedMonthlyCosts * k, contractorMonthly: i.contractorMonthly * k,
        hostingAiPerCustomerMonthly: i.hostingAiPerCustomerMonthly * k,
      }),
    },
  ];
  return {
    base,
    pct,
    rows: drivers.map((d) => ({
      label: d.label,
      down: runModel(d.apply(inputs, 1 - f)).ownerEarningsYear2,
      up: runModel(d.apply(inputs, 1 + f)).ownerEarningsYear2,
    })),
  };
}

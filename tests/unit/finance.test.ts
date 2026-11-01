import { describe, expect, it } from "vitest";
import { runModel, runScenarios, sensitivity, DEFAULT_INPUTS, type FinancialInputs } from "@/lib/finance";

const oneOff: FinancialInputs = {
  ...DEFAULT_INPUTS, revenueModel: "one_off", price: 100, newCustomersPerMonth: 10, grossMarginPct: 80,
  hostingAiPerCustomerMonthly: 5, cac: 20, fixedMonthlyCosts: 300, startupInvestment: 1000,
  conversionRatePct: 2, horizonMonths: 12, ownerHoursPerWeek: 10,
};

describe("financial model accuracy (acceptance test 6)", () => {
  it("one-off sales: hand-calculated monthly and annual figures", () => {
    // revenue 10×100 = 1000; GP = 1000×0.8 − 10×5 = 750; costs = 300 + 10×20 = 500; profit 250/month
    const r = runModel(oneOff);
    expect(r.months[0].revenue).toBe(1000);
    expect(r.months[0].grossProfit).toBe(750);
    expect(r.months[0].operatingProfit).toBe(250);
    expect(r.annual[0]).toEqual({ year: 1, revenue: 12000, grossProfit: 9000, operatingProfit: 3000 });
    expect(r.ownerEarningsYear1).toBe(3000);
    expect(r.breakEvenMonth).toBe(1);
    expect(r.cashPaybackMonth).toBe(4); // −1000 + 4×250 = 0
    expect(r.peakCashRequired).toBe(1000);
    expect(r.contributionPerCustomerMonth).toBe(75);
    expect(r.cacPaybackMonths).toBe(0.3); // 20/75
    expect(r.leadsNeededPerMonth).toBe(500); // 10 / 2%
  });

  it("recurring: customer build-up with churn matches closed form", () => {
    const i: FinancialInputs = {
      ...DEFAULT_INPUTS, revenueModel: "recurring", price: 50, newCustomersPerMonth: 10, monthlyChurnPct: 10,
      grossMarginPct: 100, cac: 0, fixedMonthlyCosts: 100, horizonMonths: 24,
    };
    const r = runModel(i);
    // active_m = 100 × (1 − 0.9^m)
    expect(r.months[0].customers).toBeCloseTo(10, 9);
    expect(r.months[1].customers).toBeCloseTo(19, 9);
    expect(r.months[2].customers).toBeCloseTo(27.1, 9);
    const sumActive = 1200 - 900 * (1 - 0.9 ** 12);
    expect(r.annual[0].revenue).toBeCloseTo(50 * sumActive, 2);
    expect(r.annual[0].operatingProfit).toBeCloseTo(50 * sumActive - 1200, 2);
    expect(r.ltv).toBe(500); // 50 / 10%
    expect(r.steadyStateCustomers).toBe(100);
  });

  it("peak cash captures early losses beyond the startup investment", () => {
    const i: FinancialInputs = {
      ...DEFAULT_INPUTS, revenueModel: "recurring", price: 100, newCustomersPerMonth: 2, monthlyChurnPct: 0,
      grossMarginPct: 100, cac: 0, fixedMonthlyCosts: 500, startupInvestment: 2000, horizonMonths: 12,
    };
    // month m revenue = 200m; profit = 200m − 500 → −300, −100, +100 ...
    const r = runModel(i);
    expect(r.months.map((m) => m.operatingProfit).slice(0, 3)).toEqual([-300, -100, 100]);
    expect(r.peakCashRequired).toBe(2400);
    expect(r.breakEvenMonth).toBe(3);
  });

  it("scenarios are ordered conservative ≤ base ≤ optimistic", () => {
    const s = runScenarios({ ...oneOff, horizonMonths: 24 });
    expect(s.conservative.ownerEarningsYear2).toBeLessThan(s.base.ownerEarningsYear2);
    expect(s.base.ownerEarningsYear2).toBeLessThan(s.optimistic.ownerEarningsYear2);
  });

  it("sensitivity: +20% price raises year-2 profit by exactly 20% of year-2 gross revenue × margin", () => {
    const i = { ...oneOff, horizonMonths: 24 };
    const s = sensitivity(i);
    const priceRow = s.rows.find((r) => r.label === "Price")!;
    // year-2 revenue 12000; +20% price adds 2400 × 0.8 = 1920 GP
    expect(priceRow.up - s.base).toBeCloseTo(1920, 6);
    expect(s.base - priceRow.down).toBeCloseTo(1920, 6);
  });

  it("flags loss-making unit economics", () => {
    const r = runModel({ ...oneOff, price: 5 });
    expect(r.warnings.join(" ")).toMatch(/loses money/);
  });

  it("rejects invalid input", () => {
    expect(() => runModel({ ...oneOff, grossMarginPct: 140 })).toThrow();
    expect(() => runModel({ ...oneOff, price: -1 })).toThrow();
  });
});

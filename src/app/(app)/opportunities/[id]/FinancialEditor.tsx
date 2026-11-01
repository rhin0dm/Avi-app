"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { runScenarios, sensitivity, financialInputsSchema, type FinancialInputs, type Scenarios } from "@/lib/finance";
import { Hypothetical, btnPrimary } from "@/components/ui";
import { api } from "@/lib/client";
import { money, num } from "@/lib/format";

type NumKey = Exclude<keyof FinancialInputs, "currency" | "revenueModel">;
const FIELDS: [NumKey, string, string?][] = [
  ["price", "Price", "per customer per month (recurring) or per sale (one-off)"],
  ["newCustomersPerMonth", "New customers / month"],
  ["startingCustomers", "Starting customers"],
  ["monthlyChurnPct", "Monthly churn %", "recurring only"],
  ["conversionRatePct", "Lead → customer conversion %"],
  ["cac", "Acquisition cost per customer (CAC)"],
  ["grossMarginPct", "Gross margin %", "after direct delivery costs, before hosting/AI"],
  ["hostingAiPerCustomerMonthly", "Hosting + AI cost per customer / month (or per sale)"],
  ["fixedMonthlyCosts", "Other operating costs / month"],
  ["contractorMonthly", "Contractor costs / month"],
  ["startupInvestment", "Startup investment"],
  ["ownerHoursPerWeek", "Owner hours / week"],
  ["companyTaxRatePct", "Company tax rate %", "for the after-company-tax line only"],
  ["horizonMonths", "Model horizon (months)"],
];
const SCEN_KEYS = ["price", "newCustomers", "churn", "cac", "costs"] as const;

export function FinancialEditor({ id, initial }: { id: string; initial: { inputs: FinancialInputs; scenarios: Scenarios; saved: boolean } }) {
  const router = useRouter();
  const [inputs, setInputs] = useState(initial.inputs);
  const [raw, setRaw] = useState<Record<string, string>>(Object.fromEntries(FIELDS.map(([k]) => [k, String(initial.inputs[k])])));
  const [scen, setScen] = useState(initial.scenarios);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const parsed = financialInputsSchema.safeParse(inputs);
  const results = useMemo(() => (parsed.success ? runScenarios(parsed.data, scen) : null), [parsed, scen]);
  const sens = useMemo(() => (parsed.success ? sensitivity(parsed.data) : null), [parsed]);
  const cur = inputs.currency;

  function setNum(k: NumKey, s: string) {
    setRaw((r) => ({ ...r, [k]: s }));
    const n = Number(s);
    if (s.trim() !== "" && Number.isFinite(n)) setInputs((i) => ({ ...i, [k]: k === "horizonMonths" ? Math.round(n) : n }));
  }
  async function save() {
    const r = await api(`/api/opportunities/${id}/financial`, "POST", { inputs, scenarios: scen });
    setMsg(r.ok ? { ok: true, text: "Model saved" } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  }

  return (
    <div className="space-y-4">
      <Hypothetical>Every figure here is a projection from the assumptions you enter. It is not verified earning potential and must not be treated as evidence of demand.</Hypothetical>
      <section className="rounded-xl border border-line bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold">Assumptions {initial.saved ? "" : <span className="font-normal text-muted">(not saved yet)</span>}</h3>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div><label htmlFor="rm">Revenue model</label>
            <select id="rm" value={inputs.revenueModel} onChange={(e) => setInputs((i) => ({ ...i, revenueModel: e.target.value as FinancialInputs["revenueModel"] }))}>
              <option value="recurring">Recurring (subscription)</option><option value="one_off">One-off sales</option></select></div>
          <div><label htmlFor="cur">Currency</label>
            <select id="cur" value={cur} onChange={(e) => setInputs((i) => ({ ...i, currency: e.target.value }))}>
              {["AUD", "USD", "NZD", "GBP", "EUR", "CAD"].map((c) => <option key={c}>{c}</option>)}</select></div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {FIELDS.map(([k, label, hint]) => (
            <div key={k}>
              <label htmlFor={`f-${k}`} title={hint}>{label}</label>
              <input id={`f-${k}`} inputMode="decimal" value={raw[k]} onChange={(e) => setNum(k, e.target.value)} />
            </div>
          ))}
        </div>
        {!parsed.success && <p className="mt-2 text-sm text-fail">{parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}</p>}
      </section>

      <details className="rounded-xl border border-line bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold">Scenario multipliers</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="text-sm">
            <thead><tr><th></th>{SCEN_KEYS.map((k) => <th key={k} className="px-2 text-left text-xs capitalize text-muted">{k === "newCustomers" ? "new cust." : k}</th>)}</tr></thead>
            <tbody>{(["conservative", "base", "optimistic"] as const).map((s) => (
              <tr key={s}><td className="pr-2 capitalize">{s}</td>{SCEN_KEYS.map((k) => (
                <td key={k} className="px-1 py-1"><input className="!w-20" inputMode="decimal" defaultValue={scen[s][k]}
                  onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0) setScen((x) => ({ ...x, [s]: { ...x[s], [k]: n } })); }} aria-label={`${s} ${k}`} /></td>))}</tr>))}
            </tbody>
          </table>
        </div>
      </details>

      {results && (
        <section className="rounded-xl border border-line bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold">Projection</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular sm:text-sm">
              <thead className="text-xs text-muted"><tr><th className="text-left"></th><th className="pl-3 text-right">Conservative</th><th className="pl-3 text-right">Base</th><th className="pl-3 text-right">Optimistic</th></tr></thead>
              <tbody className="divide-y divide-line">
                {([
                  ["Monthly revenue (month 12)", (r) => money(r.monthlyRevenueM12, cur)],
                  ["Revenue year 1", (r) => money(r.annual[0]?.revenue, cur)],
                  ["Revenue year 2", (r) => money(r.annual[1]?.revenue, cur)],
                  ["Gross profit year 2", (r) => money(r.annual[1]?.grossProfit, cur)],
                  ["Owner earnings yr 1 (pre personal tax)", (r) => money(r.ownerEarningsYear1, cur)],
                  ["Owner earnings yr 2 (pre personal tax)", (r) => <b>{money(r.ownerEarningsYear2, cur)}</b>],
                  ["Yr 2 after company tax (if retained)", (r) => money(r.ownerEarningsYear2AfterCompanyTax, cur)],
                  ["Operating break-even", (r) => (r.breakEvenMonth ? `month ${r.breakEvenMonth}` : "not reached")],
                  ["Startup cash recovered", (r) => (r.cashPaybackMonth ? `month ${r.cashPaybackMonth}` : "not reached")],
                  ["Peak cash required", (r) => money(r.peakCashRequired, cur)],
                  ["Contribution / customer", (r) => money(r.contributionPerCustomerMonth, cur, 2)],
                  ["Lifetime value", (r) => money(r.ltv, cur)],
                  ["LTV : CAC", (r) => (r.ltvToCac !== null ? `${num(r.ltvToCac)} : 1` : "—")],
                  ["CAC payback", (r) => (r.cacPaybackMonths !== null ? `${num(r.cacPaybackMonths)} mo` : "—")],
                  ["Steady-state customers", (r) => num(r.steadyStateCustomers, 0)],
                  ["Leads needed / month", (r) => num(r.leadsNeededPerMonth, 0)],
                  ["Owner hourly rate yr 2", (r) => money(r.effectiveHourlyRateYear2, cur)],
                ] as [string, (r: ReturnType<typeof runScenarios>["base"]) => React.ReactNode][]).map(([label, f]) => (
                  <tr key={label}><td className="py-1.5 pr-2">{label}</td><td className="whitespace-nowrap pl-3 text-right">{f(results.conservative)}</td><td className="whitespace-nowrap pl-3 text-right">{f(results.base)}</td><td className="whitespace-nowrap pl-3 text-right">{f(results.optimistic)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {results.base.warnings.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-inv">{results.base.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </section>
      )}

      {sens && (
        <section className="rounded-xl border border-line bg-white p-4">
          <h3 className="mb-1 text-sm font-semibold">Sensitivity — base case year-2 owner earnings</h3>
          <p className="mb-3 text-xs text-muted">Each driver moved ±{sens.pct}% on its own. Base: {money(sens.base, cur)}.</p>
          <table className="w-full text-xs tabular sm:text-sm">
            <thead className="text-xs text-muted"><tr><th className="text-left">Driver</th><th className="text-right">−{sens.pct}%</th><th className="text-right">+{sens.pct}%</th><th className="text-right">Swing</th></tr></thead>
            <tbody className="divide-y divide-line">
              {[...sens.rows].sort((a, b) => Math.abs(b.up - b.down) - Math.abs(a.up - a.down)).map((r) => (
                <tr key={r.label}><td className="py-1.5">{r.label}</td><td className="whitespace-nowrap pl-2 text-right">{money(r.down, cur)}</td><td className="whitespace-nowrap pl-2 text-right">{money(r.up, cur)}</td><td className="whitespace-nowrap pl-2 text-right text-muted">{money(Math.abs(r.up - r.down), cur)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="flex items-center gap-3">
        <button className={btnPrimary} onClick={save} disabled={!parsed.success}>Save model</button>
        {msg && <span className={`text-sm ${msg.ok ? "text-pass" : "text-fail"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}

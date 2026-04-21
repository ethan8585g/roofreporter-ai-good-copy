// ============================================================
// Solar financing scenarios — pure TypeScript financial math.
//
// Every competitor (Aurora, OpenSolar, Sighten, Enerflo) shows cash / loan
// / lease / PPA side-by-side. This module is the engine behind that UI.
//
// All functions are pure (no network, no D1) so they can be vitest'ed
// against hand-computed fixtures. The stored-snapshot shape at
// solar_proposals.financing_scenarios_json is the return value of
// computeAllScenarios — parse it directly in the homeowner HTML.
//
// Conventions:
//   - All CAD. Rates that end in _pct are percentages (e.g. 7.99 = 7.99%).
//   - Production is after degradation each year: kwh_yr_t = kwh_0 * (1 - d)^t
//   - Utility rate escalates each year: rate_t = rate_0 * (1 + e)^t
//   - Savings each year: kwh_yr_t * rate_t  (minus loan/lease payment if any)
// ============================================================

export interface FinancingInputs {
  gross_cost_cad: number
  rebates_cad: number              // federal + provincial + utility incentives
  net_cost_cad: number             // gross - rebates  (caller supplies; we trust)
  annual_production_kwh: number    // year-1 production
  utility_rate_per_kwh: number     // $/kWh today
  utility_escalator_pct?: number   // default 3%
  discount_rate_pct?: number       // default 5%
  system_degradation_pct?: number  // default 0.5%/yr
  analysis_years?: number          // default 25
}

export interface CashScenario {
  type: 'cash'
  net_cost_cad: number
  payback_years: number | null
  npv_cad: number
  irr_pct: number | null
  lcoe_cad_per_kwh: number
  savings_25yr_cad: number
  year1_savings_cad: number
  monthly_payment_cad: 0
}

export interface LoanTerms {
  label?: string
  apr_pct: number           // annualized
  term_years: number
  dealer_fee_pct?: number   // financed fee rolled into principal (common for solar loans)
  down_payment_cad?: number
}

export interface LoanScenario {
  type: 'loan'
  label?: string
  apr_pct: number
  term_years: number
  dealer_fee_pct: number
  principal_cad: number
  monthly_payment_cad: number
  total_interest_cad: number
  net_cost_over_loan_cad: number
  year1_savings_cad: number      // utility savings - payments in yr 1
  savings_25yr_cad: number
  npv_cad: number
  lcoe_cad_per_kwh: number
}

export interface LeaseTerms {
  label?: string
  monthly_payment_cad: number
  escalator_pct: number     // annual payment escalation
  term_years: number
}

export interface LeaseScenario {
  type: 'lease'
  label?: string
  monthly_payment_cad: number
  escalator_pct: number
  term_years: number
  year1_savings_cad: number
  savings_total_cad: number
  npv_cad: number
}

export interface PPATerms {
  label?: string
  rate_per_kwh_cad: number
  escalator_pct: number
  term_years: number
}

export interface PPAScenario {
  type: 'ppa'
  label?: string
  rate_per_kwh_cad: number
  escalator_pct: number
  term_years: number
  year1_savings_cad: number
  savings_total_cad: number
  npv_cad: number
}

export type Scenario = CashScenario | LoanScenario | LeaseScenario | PPAScenario

// ── Core annual cash-flow engine ──────────────────────────
// Returns per-year [0..analysis_years-1] utility-bill value and production.
function projectYears(inputs: Required<FinancingInputs>) {
  const { annual_production_kwh, utility_rate_per_kwh,
          utility_escalator_pct, system_degradation_pct, analysis_years } = inputs
  const e = utility_escalator_pct / 100
  const d = system_degradation_pct / 100
  const out: Array<{ kwh: number; rate: number; grid_bill_value: number }> = []
  for (let t = 0; t < analysis_years; t++) {
    const kwh = annual_production_kwh * Math.pow(1 - d, t)
    const rate = utility_rate_per_kwh * Math.pow(1 + e, t)
    out.push({ kwh, rate, grid_bill_value: kwh * rate })
  }
  return out
}

// Net Present Value of a cash-flow array at discount rate r (decimal, per year).
// Convention: index 0 = year 1 (one period of discount). This matches the
// "invest today, first savings show up at end of year 1" mental model.
export function npv(cashFlows: number[], r: number): number {
  let total = 0
  for (let t = 0; t < cashFlows.length; t++) total += cashFlows[t] / Math.pow(1 + r, t + 1)
  return total
}

// Internal Rate of Return — Newton-Raphson with bisection fallback.
// cfs[0] is the initial outflow (negative), cfs[1..] are yearly inflows.
// Returns IRR as decimal (0.07 = 7%), or null if it can't converge.
export function irr(cfs: number[]): number | null {
  // Sanity: at least one negative and one positive, otherwise IRR is undefined.
  if (!cfs.some((c) => c > 0) || !cfs.some((c) => c < 0)) return null

  const f = (r: number) => {
    let v = 0
    for (let t = 0; t < cfs.length; t++) v += cfs[t] / Math.pow(1 + r, t)
    return v
  }

  // Try Newton-Raphson from 10%.
  let r = 0.1
  for (let i = 0; i < 50; i++) {
    const v = f(r)
    // Numerical derivative.
    const dv = (f(r + 1e-6) - v) / 1e-6
    if (!isFinite(dv) || Math.abs(dv) < 1e-12) break
    const rNew = r - v / dv
    if (!isFinite(rNew)) break
    if (Math.abs(rNew - r) < 1e-7) return rNew
    r = rNew
    if (r <= -0.99) r = -0.9   // stay in the real domain
  }

  // Bisection fallback in [-0.99, 5.0].
  let lo = -0.99, hi = 5.0
  let flo = f(lo), fhi = f(hi)
  if (flo * fhi > 0) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const fmid = f(mid)
    if (Math.abs(fmid) < 1e-6) return mid
    if (flo * fmid < 0) { hi = mid; fhi = fmid } else { lo = mid; flo = fmid }
  }
  return (lo + hi) / 2
}

// Loan monthly payment — standard amortization P * i / (1 - (1+i)^-n)
// Returns 0 for a 0-APR or 0-term case to avoid NaN.
export function loanMonthlyPayment(principal: number, aprPct: number, termYears: number): number {
  const n = Math.round(termYears * 12)
  if (principal <= 0 || n <= 0) return 0
  const i = (aprPct / 100) / 12
  if (i === 0) return principal / n
  return principal * i / (1 - Math.pow(1 + i, -n))
}

// Years until cumulative (undiscounted) savings covers net cost. Interpolates
// within the year the crossover happens so we don't report integer-only paybacks.
export function paybackYears(netCost: number, yearlyNetCashIn: number[]): number | null {
  let cum = 0
  for (let t = 0; t < yearlyNetCashIn.length; t++) {
    const next = cum + yearlyNetCashIn[t]
    if (next >= netCost) {
      const remainder = netCost - cum
      const frac = yearlyNetCashIn[t] > 0 ? remainder / yearlyNetCashIn[t] : 0
      return Math.round((t + frac) * 100) / 100
    }
    cum = next
  }
  return null // never pays back within analysis window
}

function withDefaults(i: FinancingInputs): Required<FinancingInputs> {
  return {
    ...i,
    utility_escalator_pct: i.utility_escalator_pct ?? 3,
    discount_rate_pct: i.discount_rate_pct ?? 5,
    system_degradation_pct: i.system_degradation_pct ?? 0.5,
    analysis_years: i.analysis_years ?? 25,
  }
}

// ── Cash ──────────────────────────────────────────────────
export function computeCashScenario(raw: FinancingInputs): CashScenario {
  const i = withDefaults(raw)
  const years = projectYears(i)
  const r = i.discount_rate_pct / 100
  const savings = years.map((y) => y.grid_bill_value)      // homeowner avoids the whole bill
  const totalProduction = years.reduce((s, y) => s + y.kwh, 0)
  const total25 = savings.reduce((s, v) => s + v, 0)
  const cashNpv = npv(savings, r) - i.net_cost_cad
  const cashIrr = irr([-i.net_cost_cad, ...savings])
  const payback = paybackYears(i.net_cost_cad, savings)
  const lcoe = totalProduction > 0 ? i.net_cost_cad / totalProduction : 0
  return {
    type: 'cash',
    net_cost_cad: round(i.net_cost_cad),
    payback_years: payback,
    npv_cad: round(cashNpv),
    irr_pct: cashIrr == null ? null : round(cashIrr * 100, 2),
    lcoe_cad_per_kwh: round(lcoe, 4),
    savings_25yr_cad: round(total25),
    year1_savings_cad: round(savings[0]),
    monthly_payment_cad: 0,
  }
}

// ── Loan ──────────────────────────────────────────────────
export function computeLoanScenario(raw: FinancingInputs, terms: LoanTerms): LoanScenario {
  const i = withDefaults(raw)
  const years = projectYears(i)
  const r = i.discount_rate_pct / 100
  const dealerFeePct = terms.dealer_fee_pct ?? 0
  const down = terms.down_payment_cad ?? 0

  // Dealer fee inflates the principal so the lender still receives net_cost.
  // principal = (net_cost - down) / (1 - fee%)
  const fee = dealerFeePct / 100
  const principal = (i.net_cost_cad - down) / (1 - fee)
  const monthly = loanMonthlyPayment(principal, terms.apr_pct, terms.term_years)
  const totalPaid = monthly * terms.term_years * 12 + down
  const totalInterest = totalPaid - i.net_cost_cad - (principal - (i.net_cost_cad - down))
  // ^ interest portion only. (principal - net_cost+down) is the financed fee.

  // Net cash each year: utility savings - loan payments (payments stop after term).
  const net: number[] = []
  for (let t = 0; t < i.analysis_years; t++) {
    const paymentsThisYear = t < terms.term_years ? monthly * 12 : 0
    net.push(years[t].grid_bill_value - paymentsThisYear)
  }
  const totalSavings = net.reduce((s, v) => s + v, 0) - down
  const loanNpv = npv(net, r) - down

  // LCOE on a loan = total $ paid to lender (+ down) / lifetime production
  const totalProduction = years.reduce((s, y) => s + y.kwh, 0)
  const lcoe = totalProduction > 0 ? totalPaid / totalProduction : 0

  return {
    type: 'loan',
    label: terms.label,
    apr_pct: terms.apr_pct,
    term_years: terms.term_years,
    dealer_fee_pct: dealerFeePct,
    principal_cad: round(principal),
    monthly_payment_cad: round(monthly, 2),
    total_interest_cad: round(totalInterest),
    net_cost_over_loan_cad: round(totalPaid),
    year1_savings_cad: round(net[0]),
    savings_25yr_cad: round(totalSavings),
    npv_cad: round(loanNpv),
    lcoe_cad_per_kwh: round(lcoe, 4),
  }
}

// ── Lease ─────────────────────────────────────────────────
export function computeLeaseScenario(raw: FinancingInputs, terms: LeaseTerms): LeaseScenario {
  const i = withDefaults(raw)
  const years = projectYears(i)
  const r = i.discount_rate_pct / 100
  const esc = terms.escalator_pct / 100
  const net: number[] = []
  for (let t = 0; t < i.analysis_years; t++) {
    const payment = t < terms.term_years ? terms.monthly_payment_cad * 12 * Math.pow(1 + esc, t) : 0
    net.push(years[t].grid_bill_value - payment)
  }
  return {
    type: 'lease',
    label: terms.label,
    monthly_payment_cad: round(terms.monthly_payment_cad, 2),
    escalator_pct: terms.escalator_pct,
    term_years: terms.term_years,
    year1_savings_cad: round(net[0]),
    savings_total_cad: round(net.reduce((s, v) => s + v, 0)),
    npv_cad: round(npv(net, r)),
  }
}

// ── PPA ───────────────────────────────────────────────────
export function computePPAScenario(raw: FinancingInputs, terms: PPATerms): PPAScenario {
  const i = withDefaults(raw)
  const years = projectYears(i)
  const r = i.discount_rate_pct / 100
  const esc = terms.escalator_pct / 100
  const net: number[] = []
  for (let t = 0; t < i.analysis_years; t++) {
    const ppaRate = terms.rate_per_kwh_cad * Math.pow(1 + esc, t)
    // Homeowner pays PPA provider ppaRate per kWh instead of utility.
    const ppaCost = t < terms.term_years ? years[t].kwh * ppaRate : 0
    const saved = years[t].grid_bill_value - ppaCost
    net.push(saved)
  }
  return {
    type: 'ppa',
    label: terms.label,
    rate_per_kwh_cad: round(terms.rate_per_kwh_cad, 4),
    escalator_pct: terms.escalator_pct,
    term_years: terms.term_years,
    year1_savings_cad: round(net[0]),
    savings_total_cad: round(net.reduce((s, v) => s + v, 0)),
    npv_cad: round(npv(net, r)),
  }
}

// ── Orchestrator ──────────────────────────────────────────
export function computeAllScenarios(
  inputs: FinancingInputs,
  loanTerms: LoanTerms[] = [],
  leaseTerms: LeaseTerms[] = [],
  ppaTerms: PPATerms[] = [],
): Scenario[] {
  const out: Scenario[] = [computeCashScenario(inputs)]
  for (const t of loanTerms) out.push(computeLoanScenario(inputs, t))
  for (const t of leaseTerms) out.push(computeLeaseScenario(inputs, t))
  for (const t of ppaTerms) out.push(computePPAScenario(inputs, t))
  return out
}

function round(n: number, digits = 0): number {
  const f = Math.pow(10, digits)
  return Math.round(n * f) / f
}

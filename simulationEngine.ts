// src/tools/simulationEngine.ts
// ─────────────────────────────────────────────
//  Monte Carlo + deterministic strategy simulator
//  Models the financial impact of strategy changes
// ─────────────────────────────────────────────

import {
  SalesDataset, SalesSummary, SimulationScenario, SimulationResult,
  StrategyParameter, StrategyType,
} from "../types";
import { computeSalesSummary } from "./analyticsEngine";

// ── Helpers ───────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function gaussian(mu: number, sigma: number): number {
  // Box-Muller transform
  const u1 = Math.random(), u2 = Math.random();
  return mu + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function addMonths(base: Date, n: number): string {
  const d = new Date(base.getFullYear(), base.getMonth() + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Strategy impact models ────────────────────────────────

interface ImpactModel {
  revenueMultiplier:  number;
  profitMultiplier:   number;
  volumeMultiplier:   number;
  rampUpMonths:       number;
  implementationCost: number;
  riskFactor:         number; // 0-1, higher = more uncertain
}

function computeImpact(
  scenario: SimulationScenario,
  baseline: { revenue: number; profit: number; volume: number }
): ImpactModel {
  let revenueMultiplier  = 1;
  let profitMultiplier   = 1;
  let volumeMultiplier   = 1;
  let implementationCost = 0;
  let rampUpMonths       = 3;
  let riskFactor         = 0.15;

  for (const p of scenario.parameters) {
    const delta = (p.proposedValue - p.currentValue) / (p.currentValue || 1);

    switch (scenario.strategyType) {
      case "price_optimization":
        // Price elasticity model: 1% price increase → ~0.5-1.5% volume decrease
        revenueMultiplier += delta * 0.7;
        volumeMultiplier  -= delta * 1.0;
        profitMultiplier  += delta * 1.2;
        riskFactor = 0.2;
        break;

      case "market_expansion":
        revenueMultiplier  += Math.abs(delta) * 0.4;
        volumeMultiplier   += Math.abs(delta) * 0.45;
        implementationCost += baseline.revenue * Math.abs(delta) * 0.15;
        rampUpMonths       = 6;
        riskFactor         = 0.35;
        break;

      case "product_mix":
        revenueMultiplier += delta * 0.3;
        profitMultiplier  += delta * 0.5; // premium mix → better margin
        riskFactor        = 0.18;
        break;

      case "channel_shift":
        revenueMultiplier += delta * 0.2;
        profitMultiplier  += delta * 0.4; // digital channels → lower cost
        implementationCost += baseline.revenue * 0.03;
        rampUpMonths       = 4;
        riskFactor         = 0.22;
        break;

      case "discount_policy":
        // Reducing discounts: raises effective price, may reduce volume
        volumeMultiplier  += delta * 0.8;  // looser discount → more volume
        revenueMultiplier += delta * 0.5;
        profitMultiplier  -= delta * 0.3;  // more discounts → lower margin
        riskFactor        = 0.12;
        break;

      case "customer_segment_focus":
        revenueMultiplier += Math.abs(delta) * 0.35;
        profitMultiplier  += Math.abs(delta) * 0.55;
        implementationCost += baseline.revenue * 0.02;
        rampUpMonths       = 5;
        riskFactor         = 0.25;
        break;

      case "capacity_planning":
        volumeMultiplier   += Math.abs(delta) * 0.6;
        revenueMultiplier  += Math.abs(delta) * 0.5;
        implementationCost += baseline.revenue * Math.abs(delta) * 0.25;
        rampUpMonths       = 8;
        riskFactor         = 0.28;
        break;
    }
  }

  return {
    revenueMultiplier:  Math.max(0.5, revenueMultiplier),
    profitMultiplier:   Math.max(0.3, profitMultiplier),
    volumeMultiplier:   Math.max(0.4, volumeMultiplier),
    rampUpMonths,
    implementationCost: Math.round(implementationCost),
    riskFactor,
  };
}

// ── Monte Carlo monthly projection ───────────────────────

function projectMonthly(
  baseline:   { revenue: number; profit: number },
  impact:     ImpactModel,
  horizon:    number
): SimulationResult["monthlyProjection"] {
  const monthlyBase = baseline.revenue / 12;
  const monthlyProfit = baseline.profit / 12;
  const now = new Date();
  let cumulative = -impact.implementationCost;

  return Array.from({ length: horizon }, (_, i) => {
    const rampFactor = Math.min(1, (i + 1) / impact.rampUpMonths);
    const noise      = gaussian(1, impact.riskFactor * 0.1);
    const multiplier = 1 + (impact.revenueMultiplier - 1) * rampFactor;
    const revenue    = Math.round(monthlyBase  * multiplier * noise);
    const profit     = Math.round(monthlyProfit * impact.profitMultiplier * rampFactor * noise);

    cumulative += profit - monthlyProfit;
    const roi = impact.implementationCost > 0
      ? Math.round((cumulative / impact.implementationCost) * 100)
      : Math.round((cumulative / Math.max(1, baseline.profit / 12)) * 100);

    return { month: addMonths(now, i + 1), revenue, profit, cumulativeROI: roi };
  });
}

// ── Risk generation ───────────────────────────────────────

function buildRisks(scenario: SimulationScenario, impact: ImpactModel) {
  const riskMap: Record<StrategyType, Array<{ risk: string; likelihood: string; impact: string }>> = {
    price_optimization: [
      { risk: "Customer churn from price sensitivity", likelihood: "Medium", impact: "High" },
      { risk: "Competitor price retaliation",          likelihood: "Medium", impact: "Medium" },
      { risk: "Brand perception damage if over-priced",likelihood: "Low",    impact: "High" },
    ],
    market_expansion: [
      { risk: "Longer-than-expected ramp-up",     likelihood: "High",   impact: "Medium" },
      { risk: "Regulatory or compliance issues",  likelihood: "Low",    impact: "High" },
      { risk: "Cultural misalignment in new market", likelihood: "Medium", impact: "Medium" },
    ],
    product_mix: [
      { risk: "Cannibalisation of existing products", likelihood: "Medium", impact: "Medium" },
      { risk: "Inventory imbalance during transition", likelihood: "High", impact: "Low" },
    ],
    channel_shift: [
      { risk: "Channel conflict with partners",   likelihood: "High",   impact: "Medium" },
      { risk: "Technology integration delays",    likelihood: "Medium", impact: "Medium" },
    ],
    discount_policy: [
      { risk: "Volume drop if discounts reduced", likelihood: "High",   impact: "High" },
      { risk: "Customer expectation reset takes time", likelihood: "Medium", impact: "Low" },
    ],
    customer_segment_focus: [
      { risk: "Over-concentration in one segment", likelihood: "Low",  impact: "High" },
      { risk: "Other segments feel neglected",     likelihood: "Medium", impact: "Low" },
    ],
    capacity_planning: [
      { risk: "Capital tied up longer than expected", likelihood: "Medium", impact: "High" },
      { risk: "Demand doesn't materialise",           likelihood: "Low",    impact: "High" },
    ],
  };

  return riskMap[scenario.strategyType] ?? [
    { risk: "Execution risk", likelihood: "Medium", impact: "Medium" },
  ];
}

// ── Recommendations ───────────────────────────────────────

function buildRecommendations(
  scenario:  SimulationScenario,
  delta:     SimulationResult["delta"],
  impact:    ImpactModel
): string[] {
  const recs: string[] = [];

  if (delta.roi > 0)
    recs.push(`Strategy is ROI-positive (${delta.roi.toFixed(0)}%) — proceed with pilot before full rollout`);
  else
    recs.push("Current projection shows negative ROI — revisit parameter assumptions or extend time horizon");

  if (delta.paybackMonths > 0 && delta.paybackMonths <= 6)
    recs.push(`Fast payback in ${delta.paybackMonths} months — prioritise for Q1 implementation`);
  else if (delta.paybackMonths > 12)
    recs.push("Payback period exceeds 12 months — seek board approval and set clear milestone gates");

  if (impact.rampUpMonths > 4)
    recs.push(`Plan for ${impact.rampUpMonths}-month ramp-up; front-load hiring/marketing spend in months 1-2`);

  if (delta.profitChangePct < 0)
    recs.push("Profit margin expected to compress — identify cost-offset measures before launch");
  else
    recs.push(`Profit margin improves by ${delta.profitChangePct.toFixed(1)}% — highlight in investor communications`);

  recs.push("Run an A/B pilot on 15-20% of the customer base before full deployment");
  recs.push("Establish monthly KPI check-ins with clear go/no-go decision criteria at month 3 and 6");

  return recs;
}

// ── Public Simulation API ─────────────────────────────────

export function runSimulation(
  dataset:  SalesDataset,
  scenario: SimulationScenario,
  summary?: SalesSummary
): SimulationResult {
  if (!summary) summary = computeSalesSummary(dataset);

  const baseline = {
    revenue: summary.totalRevenue,
    profit:  summary.totalProfit,
    margin:  summary.profitMargin,
    volume:  summary.totalOrders,
  };

  const impact = computeImpact(scenario, {
    revenue: baseline.revenue,
    profit:  baseline.profit,
    volume:  baseline.volume,
  });

  // Monte Carlo: run 500 simulations and take median
  const mcRevenue: number[] = [], mcProfit: number[] = [];
  for (let i = 0; i < 500; i++) {
    const noise = gaussian(1, impact.riskFactor * 0.15);
    mcRevenue.push(baseline.revenue * impact.revenueMultiplier * noise);
    mcProfit.push(baseline.profit * impact.profitMultiplier * noise);
  }
  mcRevenue.sort((a, b) => a - b);
  mcProfit.sort((a, b) => a - b);

  const projectedRevenue = Math.round(mcRevenue[250]); // median
  const projectedProfit  = Math.round(mcProfit[250]);
  const projectedMargin  = Math.round((projectedProfit / projectedRevenue) * 1000) / 10;
  const projectedVolume  = Math.round(baseline.volume * impact.volumeMultiplier);

  const revenueChange    = projectedRevenue - baseline.revenue;
  const profitChange     = projectedProfit  - baseline.profit;
  const revenueChangePct = Math.round((revenueChange / baseline.revenue) * 1000) / 10;
  const profitChangePct  = Math.round((profitChange  / baseline.profit ) * 1000) / 10;

  const annualProfitGain = profitChange * (12 / (scenario.timeHorizon || 12));
  const roi = impact.implementationCost > 0
    ? Math.round(((annualProfitGain - impact.implementationCost) / impact.implementationCost) * 1000) / 10
    : Math.round(revenueChangePct);

  const monthlyProfitGain = profitChange / 12;
  const paybackMonths = impact.implementationCost > 0 && monthlyProfitGain > 0
    ? Math.ceil(impact.implementationCost / monthlyProfitGain)
    : 0;

  const monthlyProjection = projectMonthly(baseline, impact, scenario.timeHorizon || 12);
  const risks              = buildRisks(scenario, impact);

  const delta = { revenueChange, profitChange, marginChange: projectedMargin - baseline.margin,
                  revenueChangePct, profitChangePct, roi, paybackMonths };

  const recommendations = buildRecommendations(scenario, delta, impact);

  // Confidence: higher when fewer parameters, lower risk, shorter horizon
  const confidence = Math.round(
    Math.min(95, Math.max(50,
      90 - impact.riskFactor * 40 - (scenario.timeHorizon || 12) * 0.5
    ))
  );

  return {
    scenario,
    baseline:  { ...baseline, margin: Math.round(baseline.margin * 10) / 10 },
    projected: { revenue: projectedRevenue, profit: projectedProfit,
                 margin: projectedMargin, volume: projectedVolume },
    delta, monthlyProjection, risks, recommendations, confidenceScore: confidence,
  };
}

// ── Preset Scenarios ──────────────────────────────────────

export function getPresetScenarios(summary: SalesSummary): SimulationScenario[] {
  const avgPrice = summary.averageOrderValue;
  const topProduct = summary.topProducts[0]?.name ?? "Product A";

  return [
    {
      name: "10% Price Increase on Premium SKUs",
      description: "Raise prices on top-tier products by 10% to improve margin",
      strategyType: "price_optimization",
      timeHorizon: 12,
      parameters: [{ name: "Unit Price", currentValue: avgPrice, proposedValue: avgPrice * 1.10,
                      unit: "USD", impact: "revenue" }],
      assumptions: ["Price elasticity of -0.8", "No competitor response in Q1"],
    },
    {
      name: "Expand into Asia Pacific",
      description: "Allocate 20% additional sales headcount to APAC region",
      strategyType: "market_expansion",
      timeHorizon: 18,
      parameters: [{ name: "APAC Revenue Share", currentValue: 15, proposedValue: 25,
                      unit: "%", impact: "revenue" }],
      assumptions: ["6-month ramp-up", "Partner channel for distribution"],
    },
    {
      name: "Reduce Average Discount from 15% to 8%",
      description: "Tighten discount policy to improve net revenue",
      strategyType: "discount_policy",
      timeHorizon: 12,
      parameters: [{ name: "Avg Discount Rate", currentValue: 15, proposedValue: 8,
                      unit: "%", impact: "margin" }],
      assumptions: ["5% volume reduction expected", "Sales training on value selling"],
    },
    {
      name: "Enterprise Segment Focus",
      description: `Double down on Enterprise deals for ${topProduct}`,
      strategyType: "customer_segment_focus",
      timeHorizon: 12,
      parameters: [{ name: "Enterprise Revenue Share", currentValue: 30, proposedValue: 50,
                      unit: "%", impact: "revenue" }],
      assumptions: ["Longer sales cycles; 5-month ramp-up", "ACV 3x vs SMB"],
    },
  ];
}

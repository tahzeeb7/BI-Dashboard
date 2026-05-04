// src/tools/forecastingEngine.ts
// ─────────────────────────────────────────────
//  Implements multiple ML forecasting methods:
//    1. Linear Regression with trend
//    2. Exponential Smoothing (Holt-Winters)
//    3. Seasonal Decomposition + ARIMA-like
//    4. Ensemble (weighted average of above)
// ─────────────────────────────────────────────

import { SalesDataset, ForecastResult, ForecastPoint, ForecastMethod } from "../types";
import { getMonthlyTimeSeries } from "../utils/dataProcessor";

// ── Helpers ───────────────────────────────────────────────

function mean(arr: number[]): number { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function std(arr: number[]):  number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
}
function computeR2(actual: number[], predicted: number[]): number {
  const m   = mean(actual);
  const sst = actual.reduce((s, y) => s + (y - m) ** 2, 0);
  const sse = actual.reduce((s, y, i) => s + (y - predicted[i]) ** 2, 0);
  return 1 - sse / sst;
}
function computeMAE (actual: number[], predicted: number[]): number {
  return mean(actual.map((y, i) => Math.abs(y - predicted[i])));
}
function computeRMSE(actual: number[], predicted: number[]): number {
  return Math.sqrt(mean(actual.map((y, i) => (y - predicted[i]) ** 2)));
}
function computeMAPE(actual: number[], predicted: number[]): number {
  return mean(actual.map((y, i) => Math.abs((y - predicted[i]) / (y || 1)))) * 100;
}

function addMonths(yearMonth: string, n: number): string {
  const [y, m]  = yearMonth.split("-").map(Number);
  const d       = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function zScore(confidence: number): number {
  // Approximate z-scores
  const table: Record<number, number> = { 0.90: 1.645, 0.95: 1.96, 0.99: 2.576 };
  return table[confidence] ?? 1.96;
}

// ── 1. Linear Regression ─────────────────────────────────

function linearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const xm = mean(x), ym = mean(values);
  const num = x.reduce((s, xi, i) => s + (xi - xm) * (values[i] - ym), 0);
  const den = x.reduce((s, xi) =>    s + (xi - xm) ** 2, 0);
  const slope     = num / den;
  const intercept = ym - slope * xm;
  return { slope, intercept };
}

function forecastLinear(
  series: number[],
  horizon: number,
  confidence: number
): { predictions: number[]; stdErr: number } {
  const { slope, intercept } = linearRegression(series);
  const fitted   = series.map((_, i) => intercept + slope * i);
  const residuals = series.map((y, i) => y - fitted[i]);
  const mse      = mean(residuals.map((r) => r ** 2));
  const stdErr   = Math.sqrt(mse);
  const predictions = Array.from({ length: horizon }, (_, i) =>
    Math.max(0, intercept + slope * (series.length + i))
  );
  return { predictions, stdErr };
}

// ── 2. Holt-Winters Double Exponential Smoothing ──────────

function holtWinters(
  series: number[],
  horizon: number,
  alpha = 0.4,
  beta  = 0.3
): { predictions: number[]; smoothed: number[] } {
  if (series.length < 2) return { predictions: series, smoothed: series };

  let level = series[0];
  let trend = series[1] - series[0];
  const smoothed: number[] = [level];

  for (let i = 1; i < series.length; i++) {
    const prevLevel = level;
    level = alpha * series[i] + (1 - alpha) * (prevLevel + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    smoothed.push(level);
  }

  const predictions = Array.from({ length: horizon }, (_, i) =>
    Math.max(0, level + (i + 1) * trend)
  );
  return { predictions, smoothed };
}

// ── 3. Seasonal Decomposition ─────────────────────────────

function detectSeasonality(series: number[], period = 12): { indices: number[]; detected: boolean } {
  if (series.length < period * 2) return { indices: Array(period).fill(1), detected: false };

  // Compute seasonal indices via ratio-to-moving-average
  const indices: number[] = Array(period).fill(0);
  const counts:  number[] = Array(period).fill(0);

  for (let i = period / 2; i < series.length - period / 2; i++) {
    const window = series.slice(i - period / 2, i + period / 2);
    const ma     = mean(window);
    if (ma > 0) {
      const idx = i % period;
      indices[idx] += series[i] / ma;
      counts[idx]  += 1;
    }
  }

  const si = indices.map((s, i) => (counts[i] > 0 ? s / counts[i] : 1));
  const siMean = mean(si);
  const normalised = si.map((s) => s / siMean);

  const variance = std(normalised);
  return { indices: normalised, detected: variance > 0.05 };
}

function forecastSeasonal(
  series: number[],
  horizon: number,
  confidence: number
): { predictions: number[]; seasonal: number[] } {
  const period = 12;
  const { indices, detected } = detectSeasonality(series, period);
  const { predictions: trendPred } = forecastLinear(series, horizon, confidence);

  const predictions = trendPred.map((p, i) =>
    Math.max(0, detected ? p * indices[(series.length + i) % period] : p)
  );
  return { predictions, seasonal: indices };
}

// ── 4. Ensemble Forecast ──────────────────────────────────

function ensembleForecast(
  series: number[],
  horizon: number,
  confidence: number
): number[] {
  const { predictions: linear }   = forecastLinear(series, horizon, confidence);
  const { predictions: hw }       = holtWinters(series, horizon);
  const { predictions: seasonal } = forecastSeasonal(series, horizon, confidence);

  // Weighted average: seasonal 40%, Holt-Winters 35%, linear 25%
  return linear.map((l, i) => Math.max(0, 0.25 * l + 0.35 * hw[i] + 0.40 * seasonal[i]));
}

// ── Confidence Intervals ──────────────────────────────────

function buildCI(
  predictions: number[],
  residualStd: number,
  confidence: number
): Array<{ lower: number; upper: number }> {
  const z = zScore(confidence);
  return predictions.map((p) => ({
    lower: Math.max(0, p - z * residualStd),
    upper: p + z * residualStd,
  }));
}

// ── Trend direction ───────────────────────────────────────

function trendDir(series: number[]): "upward" | "downward" | "stable" | "volatile" {
  const { slope } = linearRegression(series);
  const cv = std(series) / mean(series);
  if (cv > 0.3) return "volatile";
  if (slope > mean(series) * 0.005) return "upward";
  if (slope < -mean(series) * 0.005) return "downward";
  return "stable";
}

// ── Insights Generator ────────────────────────────────────

function generateInsights(
  series:   number[],
  forecast: number[],
  method:   ForecastMethod
): string[] {
  const insights: string[] = [];
  const avgHistorical = mean(series);
  const avgForecast   = mean(forecast);
  const growth = ((avgForecast - avgHistorical) / avgHistorical) * 100;
  const dir    = trendDir(series);

  if (growth > 10)
    insights.push(`Strong ${growth.toFixed(1)}% revenue growth projected over the forecast period`);
  else if (growth > 0)
    insights.push(`Moderate ${growth.toFixed(1)}% revenue growth expected`);
  else
    insights.push(`Revenue shows ${Math.abs(growth).toFixed(1)}% decline — investigate underlying drivers`);

  if (dir === "volatile")
    insights.push("High volatility detected — widen safety stock and pipeline buffers accordingly");
  if (dir === "upward")
    insights.push("Historical uptrend is strong and projected to continue");

  const peak = forecast.indexOf(Math.max(...forecast));
  insights.push(`Peak revenue expected in month ${peak + 1} of the forecast window`);

  if (method === "ensemble")
    insights.push("Ensemble model averages linear, exponential, and seasonal signals for higher accuracy");

  return insights;
}

// ── Public Forecast API ───────────────────────────────────

export function runForecast(
  dataset:     SalesDataset,
  method:      ForecastMethod = "ensemble",
  horizon      = 12,
  confidence   = 0.95,
  targetMetric: "revenue" | "profit" | "volume" = "revenue"
): ForecastResult {
  const monthly = getMonthlyTimeSeries(dataset);
  if (monthly.length < 4) throw new Error("Need at least 4 months of data to forecast");

  const series = monthly.map((m) =>
    targetMetric === "profit" ? m.profit : targetMetric === "volume" ? m.volume : m.revenue
  );
  const lastMonth = monthly[monthly.length - 1].month;

  let predictions: number[];
  let residualStd: number;

  switch (method) {
    case "linear": {
      const r = forecastLinear(series, horizon, confidence);
      predictions = r.predictions; residualStd = r.stdErr;
      break;
    }
    case "exponential": {
      const { predictions: hw, smoothed } = holtWinters(series, horizon);
      predictions = hw;
      residualStd = std(series.map((y, i) => y - smoothed[i]));
      break;
    }
    case "seasonal": {
      const { predictions: sp } = forecastSeasonal(series, horizon, confidence);
      predictions = sp;
      residualStd = std(series) * 0.15;
      break;
    }
    case "ensemble":
    default: {
      predictions = ensembleForecast(series, horizon, confidence);
      residualStd = std(series) * 0.12;
    }
  }

  const ci     = buildCI(predictions, residualStd, confidence);
  const fitted = (method === "linear")
    ? series.map((_, i) => { const lr = linearRegression(series); return lr.intercept + lr.slope * i; })
    : holtWinters(series, horizon).smoothed;

  const validFitted = fitted.slice(0, series.length);
  const accuracy = {
    mae:  Math.round(computeMAE(series,  validFitted)),
    rmse: Math.round(computeRMSE(series, validFitted)),
    mape: Math.round(computeMAPE(series, validFitted) * 10) / 10,
    r2:   Math.round(computeR2(series,   validFitted) * 1000) / 1000,
  };

  const { detected, indices } = detectSeasonality(series);
  const peakMonth = indices.indexOf(Math.max(...indices));

  const points: ForecastPoint[] = predictions.map((pred, i) => {
    const prevPred = i === 0 ? series[series.length - 1] : predictions[i - 1];
    const trend: "up" | "down" | "stable" =
      pred > prevPred * 1.02 ? "up" : pred < prevPred * 0.98 ? "down" : "stable";
    return {
      period: addMonths(lastMonth, i + 1),
      predicted: Math.round(pred),
      lower:     Math.round(ci[i].lower),
      upper:     Math.round(ci[i].upper),
      trend,
    };
  });

  const seasonMonths = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  return {
    method,
    horizon,
    confidenceLevel: confidence,
    points,
    accuracy,
    insights: generateInsights(series, predictions, method),
    seasonalityDetected: detected,
    trendDirection: trendDir(series),
    seasonalPeaks: detected ? [seasonMonths[peakMonth]] : undefined,
  };
}

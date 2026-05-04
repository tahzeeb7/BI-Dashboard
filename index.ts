// src/types/index.ts
// ─────────────────────────────────────────────
//  All shared types for the Sales Analytics Agent
// ─────────────────────────────────────────────

export interface SalesRecord {
  date: string;
  product: string;
  region: string;
  salesperson: string;
  quantity: number;
  unitPrice: number;
  revenue: number;
  cost: number;
  profit: number;
  channel: string;
  customerSegment: string;
  discount?: number;
}

export interface SalesDataset {
  records: SalesRecord[];
  metadata: {
    totalRecords: number;
    dateRange: { from: string; to: string };
    products: string[];
    regions: string[];
    channels: string[];
    segments: string[];
  };
}

// ─── Analytics Results ───────────────────────

export interface SalesSummary {
  totalRevenue: number;
  totalProfit: number;
  totalCost: number;
  profitMargin: number;
  averageOrderValue: number;
  totalOrders: number;
  revenueByProduct: Record<string, number>;
  revenueByRegion: Record<string, number>;
  revenueByChannel: Record<string, number>;
  revenueBySegment: Record<string, number>;
  topProducts: Array<{ name: string; revenue: number; growth: number }>;
  topRegions: Array<{ name: string; revenue: number; share: number }>;
  monthlyTrend: Array<{ month: string; revenue: number; profit: number }>;
  growthRate: number;
  conversionMetrics: {
    avgDiscount: number;
    discountImpact: number;
  };
}

// ─── Forecasting ─────────────────────────────

export type ForecastMethod = "linear" | "exponential" | "seasonal" | "ensemble";

export interface ForecastPoint {
  period: string;
  predicted: number;
  lower: number;   // confidence interval lower bound
  upper: number;   // confidence interval upper bound
  trend: "up" | "down" | "stable";
}

export interface ForecastResult {
  method: ForecastMethod;
  horizon: number;
  confidenceLevel: number;
  points: ForecastPoint[];
  accuracy: {
    mae: number;   // Mean Absolute Error
    rmse: number;  // Root Mean Square Error
    mape: number;  // Mean Absolute Percentage Error
    r2: number;    // R-squared
  };
  insights: string[];
  seasonalityDetected: boolean;
  trendDirection: "upward" | "downward" | "stable" | "volatile";
  seasonalPeaks?: string[];
}

// ─── Strategy Simulation ──────────────────────

export type StrategyType =
  | "price_optimization"
  | "market_expansion"
  | "product_mix"
  | "channel_shift"
  | "discount_policy"
  | "customer_segment_focus"
  | "capacity_planning";

export interface StrategyParameter {
  name: string;
  currentValue: number;
  proposedValue: number;
  unit: string;
  impact: "revenue" | "cost" | "volume" | "margin";
}

export interface SimulationScenario {
  name: string;
  description: string;
  strategyType: StrategyType;
  parameters: StrategyParameter[];
  timeHorizon: number; // months
  assumptions: string[];
}

export interface SimulationResult {
  scenario: SimulationScenario;
  baseline: {
    revenue: number;
    profit: number;
    margin: number;
    volume: number;
  };
  projected: {
    revenue: number;
    profit: number;
    margin: number;
    volume: number;
  };
  delta: {
    revenueChange: number;
    profitChange: number;
    marginChange: number;
    revenueChangePct: number;
    profitChangePct: number;
    roi: number;
    paybackMonths: number;
  };
  monthlyProjection: Array<{
    month: string;
    revenue: number;
    profit: number;
    cumulativeROI: number;
  }>;
  risks: Array<{ risk: string; likelihood: string; impact: string }>;
  recommendations: string[];
  confidenceScore: number;
}

// ─── ML Model Metrics ─────────────────────────

export interface MLModelMetrics {
  modelType: string;
  trainingSize: number;
  testSize: number;
  features: string[];
  metrics: {
    accuracy?: number;
    precision?: number;
    recall?: number;
    f1?: number;
    mae?: number;
    rmse?: number;
    r2?: number;
  };
  featureImportance: Array<{ feature: string; importance: number }>;
  trainingDate: string;
}

// ─── BI Report ────────────────────────────────

export interface BIReport {
  title: string;
  generatedAt: string;
  period: string;
  executiveSummary: string;
  kpis: Array<{
    name: string;
    value: number;
    unit: string;
    change: number;
    status: "good" | "warning" | "critical";
  }>;
  sections: Array<{
    title: string;
    content: string;
    charts?: string[];
  }>;
  recommendations: string[];
  riskAlerts: string[];
  forecast: ForecastResult;
  rawData?: SalesSummary;
}

// ─── Agent Messages ───────────────────────────

export interface AgentMessage {
  role: "user" | "assistant" | "tool_result";
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "running" | "completed" | "error";
}

// ─── Agent Tool Definitions ───────────────────

export interface AgentTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

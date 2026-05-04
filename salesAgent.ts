// src/agent/salesAgent.ts
// ─────────────────────────────────────────────
//  The main AI Agent brain
//  Uses Claude claude-sonnet-4-20250514 with tool_use
//  Orchestrates all analytics / forecasting / simulation
// ─────────────────────────────────────────────

import Anthropic from "@anthropic-ai/sdk";
import * as vscode from "vscode";
import {
  SalesDataset, AgentMessage, AgentTool, ForecastMethod,
  SimulationScenario, StrategyType,
} from "../types";
import { generateSyntheticData, loadSalesData } from "../utils/dataProcessor";
import { computeSalesSummary, performRFMSegmentation, analyzeFeatureImportance } from "../tools/analyticsEngine";
import { runForecast } from "../tools/forecastingEngine";
import { runSimulation, getPresetScenarios } from "../tools/simulationEngine";

// ── Tool Definitions ──────────────────────────────────────

const AGENT_TOOLS: AgentTool[] = [
  {
    name: "load_sales_data",
    description: "Load and parse a sales data file (CSV or JSON) from the workspace. Returns dataset metadata.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute or workspace-relative path to the .csv or .json file" },
        use_synthetic: { type: "boolean", description: "If true, generate 24 months of realistic synthetic data instead" },
      },
      required: [],
    },
  },
  {
    name: "analyze_sales",
    description: "Compute comprehensive sales analytics: revenue breakdown by product/region/channel, growth rate, top performers, monthly trends, discount impact.",
    input_schema: {
      type: "object",
      properties: {
        filter_product: { type: "string", description: "Optional: filter analysis to a specific product" },
        filter_region:  { type: "string", description: "Optional: filter analysis to a specific region" },
        filter_channel: { type: "string", description: "Optional: filter analysis to a specific channel" },
      },
      required: [],
    },
  },
  {
    name: "run_forecast",
    description: "Generate ML sales forecast using linear regression, exponential smoothing, seasonal decomposition, or ensemble methods.",
    input_schema: {
      type: "object",
      properties: {
        method:        { type: "string", enum: ["linear","exponential","seasonal","ensemble"], description: "Forecasting algorithm" },
        horizon:       { type: "number", description: "Number of months to forecast (1-24)" },
        confidence:    { type: "number", description: "Confidence level for intervals (0.9, 0.95, or 0.99)" },
        target_metric: { type: "string", enum: ["revenue","profit","volume"], description: "Metric to forecast" },
      },
      required: [],
    },
  },
  {
    name: "simulate_strategy",
    description: "Run Monte Carlo strategy simulation to project financial impact of a business decision.",
    input_schema: {
      type: "object",
      properties: {
        strategy_type: {
          type: "string",
          enum: ["price_optimization","market_expansion","product_mix","channel_shift","discount_policy","customer_segment_focus","capacity_planning"],
          description: "Type of strategy to simulate",
        },
        scenario_name:  { type: "string",  description: "Name for this scenario" },
        description:    { type: "string",  description: "Description of the strategy" },
        parameters: {
          type: "array",
          description: "Strategy parameters to adjust",
          items: {
            type: "object",
            properties: {
              name:           { type: "string" },
              currentValue:   { type: "number" },
              proposedValue:  { type: "number" },
              unit:           { type: "string" },
              impact:         { type: "string", enum: ["revenue","cost","volume","margin"] },
            },
          },
        },
        time_horizon: { type: "number", description: "Simulation horizon in months" },
        use_preset:   { type: "number", description: "Use a preset scenario by index (0-3) instead of custom" },
      },
      required: [],
    },
  },
  {
    name: "segment_customers",
    description: "Perform RFM (Recency, Frequency, Monetary) customer segmentation analysis.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "analyze_feature_importance",
    description: "Analyze which sales drivers (price, quantity, region, channel, discount) most strongly predict revenue using ML correlation analysis.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "generate_bi_report",
    description: "Generate a comprehensive Business Intelligence report with executive summary, KPIs, insights, and recommendations.",
    input_schema: {
      type: "object",
      properties: {
        report_period: { type: "string", description: "Period label, e.g. 'Q4 2024' or 'FY 2024'" },
        include_forecast: { type: "boolean", description: "Include a 12-month forecast section" },
        focus_area:       { type: "string", description: "Optional: focus the report on a specific area (e.g. 'profitability', 'regional', 'product')" },
      },
      required: [],
    },
  },
  {
    name: "get_preset_scenarios",
    description: "Get a list of pre-built strategy simulation scenarios based on the current sales data.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// ── Tool Execution ────────────────────────────────────────

export class SalesAgent {
  private client: Anthropic;
  private model:  string;
  private dataset: SalesDataset | null = null;
  private history: Array<Anthropic.MessageParam> = [];
  private onProgress: (msg: string) => void;

  constructor(apiKey: string, model: string, onProgress: (msg: string) => void) {
    this.client     = new Anthropic({ apiKey });
    this.model      = model;
    this.onProgress = onProgress;
  }

  // ── Reset conversation ────────────────────────────────
  reset(): void { this.history = []; this.dataset = null; }

  // ── Tool executor ─────────────────────────────────────
  private async executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    this.onProgress(`⚙️ Running tool: ${name}`);

    switch (name) {
      case "load_sales_data": {
        if (input.use_synthetic) {
          this.dataset = generateSyntheticData(24);
        } else if (input.file_path) {
          this.dataset = loadSalesData(input.file_path as string);
        } else {
          this.dataset = generateSyntheticData(24);
        }
        const { metadata } = this.dataset;
        return {
          success: true,
          records: metadata.totalRecords,
          dateRange: metadata.dateRange,
          products: metadata.products,
          regions:  metadata.regions,
          channels: metadata.channels,
          segments: metadata.segments,
          message:  `✅ Loaded ${metadata.totalRecords} sales records (${metadata.dateRange.from} → ${metadata.dateRange.to})`,
        };
      }

      case "analyze_sales": {
        if (!this.dataset) this.dataset = generateSyntheticData(24);
        let filtered = this.dataset;
        if (input.filter_product || input.filter_region || input.filter_channel) {
          filtered = {
            ...this.dataset,
            records: this.dataset.records.filter((r) =>
              (!input.filter_product || r.product === input.filter_product) &&
              (!input.filter_region  || r.region  === input.filter_region) &&
              (!input.filter_channel || r.channel === input.filter_channel)
            ),
          };
        }
        return computeSalesSummary(filtered);
      }

      case "run_forecast": {
        if (!this.dataset) this.dataset = generateSyntheticData(24);
        return runForecast(
          this.dataset,
          (input.method as ForecastMethod) || "ensemble",
          (input.horizon as number) || 12,
          (input.confidence as number) || 0.95,
          (input.target_metric as "revenue" | "profit" | "volume") || "revenue"
        );
      }

      case "simulate_strategy": {
        if (!this.dataset) this.dataset = generateSyntheticData(24);
        const summary = computeSalesSummary(this.dataset);

        let scenario: SimulationScenario;
        if (typeof input.use_preset === "number") {
          const presets = getPresetScenarios(summary);
          scenario = presets[Math.min(input.use_preset, presets.length - 1)];
        } else {
          scenario = {
            name:         (input.scenario_name as string) || "Custom Strategy",
            description:  (input.description as string) || "User-defined strategy",
            strategyType: (input.strategy_type as StrategyType) || "price_optimization",
            parameters:   (input.parameters as SimulationScenario["parameters"]) || [],
            timeHorizon:  (input.time_horizon as number) || 12,
            assumptions:  [],
          };
        }
        return runSimulation(this.dataset, scenario, summary);
      }

      case "segment_customers": {
        if (!this.dataset) this.dataset = generateSyntheticData(24);
        return performRFMSegmentation(this.dataset);
      }

      case "analyze_feature_importance": {
        if (!this.dataset) this.dataset = generateSyntheticData(24);
        return analyzeFeatureImportance(this.dataset);
      }

      case "generate_bi_report": {
        if (!this.dataset) this.dataset = generateSyntheticData(24);
        const summary  = computeSalesSummary(this.dataset);
        const forecast = (input.include_forecast !== false)
          ? runForecast(this.dataset, "ensemble", 12)
          : null;
        const rfm      = performRFMSegmentation(this.dataset);
        const features = analyzeFeatureImportance(this.dataset);
        return {
          period:   input.report_period || "Current Period",
          summary,
          forecast,
          customerSegments: rfm,
          featureImportance: features,
          generatedAt: new Date().toISOString(),
        };
      }

      case "get_preset_scenarios": {
        if (!this.dataset) this.dataset = generateSyntheticData(24);
        const summary = computeSalesSummary(this.dataset);
        return getPresetScenarios(summary);
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  // ── Agentic loop ──────────────────────────────────────
  async chat(
    userMessage: string,
    onChunk: (text: string) => void
  ): Promise<string> {
    this.history.push({ role: "user", content: userMessage });

    const systemPrompt = `You are an expert AI Sales Analytics Agent embedded in VS Code. 
You help data scientists, sales managers, and business analysts with:
- Loading and exploring sales data
- Computing advanced business intelligence metrics  
- Running ML-powered sales forecasts (linear, exponential smoothing, seasonal, ensemble)
- Simulating business strategies with Monte Carlo analysis
- Customer segmentation via RFM analysis
- Feature importance and driver analysis
- Generating comprehensive BI reports

BEHAVIOUR:
1. Always load/check data first before analysis. Use synthetic data if none is available.
2. After running any tool, interpret the results clearly with business context.
3. Highlight key insights, risks, and actionable recommendations.
4. When presenting numbers, format them clearly (currency, percentages, trends).
5. Proactively suggest follow-up analyses the user might find valuable.
6. Use emojis sparingly for visual clarity in key sections.
7. Always connect quantitative results to business decisions.

When a user asks a vague question, use your tools to gather data first, then provide a rich interpretation.`;

    let fullResponse = "";
    let continueLoop = true;

    while (continueLoop) {
      const response = await this.client.messages.create({
        model:      this.model,
        max_tokens: 4096,
        system:     systemPrompt,
        tools:      AGENT_TOOLS as Anthropic.Tool[],
        messages:   this.history,
      });

      // Collect text and tool_use blocks
      const textBlocks:    string[] = [];
      const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

      for (const block of response.content) {
        if (block.type === "text") {
          textBlocks.push(block.text);
          onChunk(block.text);
          fullResponse += block.text;
        } else if (block.type === "tool_use") {
          toolUseBlocks.push(block);
        }
      }

      // Add assistant turn to history
      this.history.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "tool_use" && toolUseBlocks.length > 0) {
        // Execute all tools and collect results
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const tb of toolUseBlocks) {
          this.onProgress(`🔧 Executing: ${tb.name}`);
          try {
            const result = await this.executeTool(tb.name, tb.input as Record<string, unknown>);
            toolResults.push({
              type:       "tool_result",
              tool_use_id: tb.id,
              content:    JSON.stringify(result, null, 2),
            });
          } catch (err) {
            toolResults.push({
              type:        "tool_result",
              tool_use_id: tb.id,
              is_error:    true,
              content:     `Error: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
        this.history.push({ role: "user", content: toolResults });
      } else {
        // No more tool calls — agent is done
        continueLoop = false;
      }
    }

    return fullResponse;
  }

  getCurrentDataset(): SalesDataset | null { return this.dataset; }
}

// ── Singleton factory ─────────────────────────────────────

let agentInstance: SalesAgent | null = null;

export function getOrCreateAgent(progress: (msg: string) => void): SalesAgent {
  const config  = vscode.workspace.getConfiguration("salesAgent");
  const apiKey  = config.get<string>("anthropicApiKey") || process.env.ANTHROPIC_API_KEY || "";
  const model   = config.get<string>("defaultModel") || "claude-sonnet-4-20250514";

  if (!apiKey) {
    throw new Error(
      "Anthropic API key not set. Go to Settings → salesAgent.anthropicApiKey or set ANTHROPIC_API_KEY env variable."
    );
  }

  // Re-create if config changed
  agentInstance = new SalesAgent(apiKey, model, progress);
  return agentInstance;
}

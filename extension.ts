// src/extension.ts
// ─────────────────────────────────────────────
//  VS Code Extension Entry Point
//  Predictive Sales Analytics & Strategy Simulation Agent
// ─────────────────────────────────────────────

import * as vscode from "vscode";
import { DashboardProvider } from "./providers/dashboardProvider";
import { ChatViewProvider }  from "./providers/chatProvider";
import { getOrCreateAgent }  from "./agent/salesAgent";
import { generateSyntheticData, loadSalesData } from "./utils/dataProcessor";
import { computeSalesSummary, performRFMSegmentation } from "./tools/analyticsEngine";
import { runForecast }         from "./tools/forecastingEngine";
import { runSimulation, getPresetScenarios } from "./tools/simulationEngine";
import { ForecastMethod, SimulationScenario, StrategyType } from "./types";

export function activate(context: vscode.ExtensionContext): void {
  console.log("[SalesAgent] Extension activated");

  // ── Providers ──────────────────────────────────────────
  const dashboard = new DashboardProvider(context);
  const chatView  = new ChatViewProvider(context);
  chatView.setDashboard(dashboard);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatView)
  );

  // ── Helper: get/ensure agent ──────────────────────────
  function withAgent(progress: (msg: string) => void) {
    return getOrCreateAgent(progress);
  }

  // ── Status bar item ───────────────────────────────────
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text    = "$(graph) Sales Agent";
  statusBar.tooltip = "Open Sales Analytics Dashboard";
  statusBar.command = "salesAgent.openDashboard";
  statusBar.show();
  context.subscriptions.push(statusBar);

  // ─────────────────────────────────────────────────────
  //  COMMAND: Open Dashboard
  // ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("salesAgent.openDashboard", async () => {
      dashboard.show();
      // Pre-populate with synthetic data if nothing loaded
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Loading sales data…", cancellable: false },
        async () => {
          try {
            const dataset = generateSyntheticData(24);
            const summary = computeSalesSummary(dataset);
            dashboard.updateSummary(summary);
            const forecast = runForecast(dataset, "ensemble");
            dashboard.updateForecast(forecast);
            const segments = performRFMSegmentation(dataset);
            dashboard.updateSegments(segments);
            const presets  = getPresetScenarios(summary);
            if (presets.length) {
              const sim = runSimulation(dataset, presets[0], summary);
              dashboard.updateSimulation(sim);
            }
          } catch (err) {
            vscode.window.showErrorMessage(`Dashboard error: ${err}`);
          }
        }
      );
    })
  );

  // ─────────────────────────────────────────────────────
  //  COMMAND: Analyze File
  // ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("salesAgent.analyzeFile", async (uri?: vscode.Uri) => {
      let filePath = uri?.fsPath;

      if (!filePath) {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany:    false,
          filters:          { "Sales Data": ["csv", "json"] },
          openLabel:        "Select Sales Data",
        });
        if (!picked?.length) return;
        filePath = picked[0].fsPath;
      }

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Analyzing ${filePath}…`, cancellable: false },
        async (prog) => {
          try {
            prog.report({ message: "Parsing file…" });
            const dataset = loadSalesData(filePath!);
            prog.report({ message: "Computing analytics…" });
            const summary = computeSalesSummary(dataset);
            dashboard.show();
            dashboard.updateSummary(summary);

            prog.report({ message: "Running forecast…" });
            const forecast = runForecast(dataset, "ensemble");
            dashboard.updateForecast(forecast);

            prog.report({ message: "Segmenting customers…" });
            const segments = performRFMSegmentation(dataset);
            dashboard.updateSegments(segments);

            vscode.window.showInformationMessage(
              `✅ Analyzed ${dataset.metadata.totalRecords} records from ${dataset.metadata.dateRange.from} → ${dataset.metadata.dateRange.to}`
            );
          } catch (err) {
            vscode.window.showErrorMessage(`Analysis failed: ${err}`);
          }
        }
      );
    })
  );

  // ─────────────────────────────────────────────────────
  //  COMMAND: Run Forecast
  // ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("salesAgent.runForecast", async () => {
      const method = await vscode.window.showQuickPick(
        [
          { label: "$(sparkle) Ensemble (Recommended)", description: "Combines linear + exponential + seasonal", value: "ensemble" },
          { label: "$(graph-line) Linear Regression",   description: "Simple trend extrapolation",              value: "linear" },
          { label: "$(graph) Exponential Smoothing",    description: "Holt-Winters double exponential",         value: "exponential" },
          { label: "$(calendar) Seasonal Decomposition",description: "STL seasonal + trend",                    value: "seasonal" },
        ],
        { placeHolder: "Select forecasting method" }
      );
      if (!method) return;

      const horizonStr = await vscode.window.showInputBox({
        prompt: "Forecast horizon (months)",
        value:  "12",
        validateInput: (v) => isNaN(+v) || +v < 1 || +v > 36 ? "Enter 1-36" : null,
      });
      if (!horizonStr) return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Running ML forecast…", cancellable: false },
        async () => {
          try {
            const config  = vscode.workspace.getConfiguration("salesAgent");
            const dataset = generateSyntheticData(24);
            const result  = runForecast(
              dataset,
              method.value as ForecastMethod,
              +horizonStr,
              config.get<number>("confidenceLevel") || 0.95
            );
            dashboard.show();
            dashboard.updateForecast(result);

            const total = result.points.reduce((s, p) => s + p.predicted, 0);
            vscode.window.showInformationMessage(
              `📈 ${horizonStr}-month ${method.value} forecast complete. Total projected: $${(total / 1e6).toFixed(2)}M`
            );
          } catch (err) {
            vscode.window.showErrorMessage(`Forecast error: ${err}`);
          }
        }
      );
    })
  );

  // ─────────────────────────────────────────────────────
  //  COMMAND: Simulate Strategy
  // ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("salesAgent.simulateStrategy", async () => {
      const dataset = generateSyntheticData(24);
      const summary = computeSalesSummary(dataset);
      const presets = getPresetScenarios(summary);

      const items = [
        ...presets.map((p, i) => ({
          label:       `$(lightbulb) ${p.name}`,
          description: p.description,
          value:       i,
        })),
        { label: "$(edit) Custom Strategy…", description: "Define your own parameters", value: -1 },
      ];

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a strategy scenario to simulate",
      });
      if (!picked) return;

      let scenario: SimulationScenario;
      if (picked.value === -1) {
        const strategyType = await vscode.window.showQuickPick(
          ["price_optimization", "market_expansion", "product_mix",
           "channel_shift", "discount_policy", "customer_segment_focus", "capacity_planning"],
          { placeHolder: "Select strategy type" }
        );
        if (!strategyType) return;
        const name = await vscode.window.showInputBox({ prompt: "Scenario name" });
        if (!name) return;
        const currentStr  = await vscode.window.showInputBox({ prompt: "Current value", value: "100" });
        const proposedStr = await vscode.window.showInputBox({ prompt: "Proposed value", value: "120" });
        if (!currentStr || !proposedStr) return;

        scenario = {
          name,
          description:  name,
          strategyType: strategyType as StrategyType,
          parameters:   [{ name: "Primary Lever", currentValue: +currentStr, proposedValue: +proposedStr, unit: "%", impact: "revenue" }],
          timeHorizon:  12,
          assumptions:  [],
        };
      } else {
        scenario = presets[picked.value];
      }

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Running Monte Carlo simulation…", cancellable: false },
        async () => {
          try {
            const result = runSimulation(dataset, scenario, summary);
            dashboard.show();
            dashboard.updateSimulation(result);
            vscode.window.showInformationMessage(
              `🎯 Simulation complete. Revenue impact: ${result.delta.revenueChangePct > 0 ? "+" : ""}${result.delta.revenueChangePct}% | ROI: ${result.delta.roi}%`
            );
          } catch (err) {
            vscode.window.showErrorMessage(`Simulation error: ${err}`);
          }
        }
      );
    })
  );

  // ─────────────────────────────────────────────────────
  //  COMMAND: Generate BI Report (saves as Markdown)
  // ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("salesAgent.generateReport", async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Generating BI Report…", cancellable: false },
        async () => {
          try {
            const dataset   = generateSyntheticData(24);
            const summary   = computeSalesSummary(dataset);
            const forecast  = runForecast(dataset, "ensemble");
            const segments  = performRFMSegmentation(dataset);
            const now       = new Date();
            const period    = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
            const totalF    = forecast.points.reduce((s, p) => s + p.predicted, 0);

            const md = `# 📊 Sales Analytics BI Report
**Period:** ${period} | **Generated:** ${now.toISOString()}

---

## 🎯 Executive Summary

Total revenue for the period reached **$${(summary.totalRevenue / 1e6).toFixed(2)}M** with a gross profit
of **$${(summary.totalProfit / 1e6).toFixed(2)}M** (${summary.profitMargin}% margin).
Revenue growth stands at **${summary.growthRate > 0 ? "+" : ""}${summary.growthRate}%** vs prior period.
The 12-month ensemble forecast projects **$${(totalF / 1e6).toFixed(2)}M** in forward revenue
with a **${forecast.trendDirection}** trend detected.

---

## 📈 Key Performance Indicators

| KPI | Value | Status |
|-----|-------|--------|
| Total Revenue | $${(summary.totalRevenue / 1e6).toFixed(2)}M | ${summary.growthRate >= 0 ? "✅" : "⚠️"} |
| Total Profit  | $${(summary.totalProfit / 1e6).toFixed(2)}M | ✅ |
| Profit Margin | ${summary.profitMargin}% | ${summary.profitMargin >= 20 ? "✅" : "⚠️"} |
| Total Orders  | ${summary.totalOrders.toLocaleString()} | ✅ |
| Avg Order Value | $${summary.averageOrderValue.toLocaleString()} | ✅ |
| Revenue Growth | ${summary.growthRate > 0 ? "+" : ""}${summary.growthRate}% | ${summary.growthRate >= 0 ? "✅" : "⚠️"} |
| Avg Discount | ${summary.conversionMetrics.avgDiscount}% | ${summary.conversionMetrics.avgDiscount <= 15 ? "✅" : "⚠️"} |

---

## 🏆 Top Products

${summary.topProducts.map((p, i) =>
  `${i + 1}. **${p.name}** — $${(p.revenue / 1e3).toFixed(0)}K revenue | Growth: ${p.growth > 0 ? "+" : ""}${p.growth}%`
).join("\n")}

---

## 🌍 Regional Performance

${summary.topRegions.map((r) =>
  `- **${r.name}**: $${(r.revenue / 1e3).toFixed(0)}K (${r.share}% share)`
).join("\n")}

---

## 📈 12-Month Forecast (Ensemble ML)

**Trend:** ${forecast.trendDirection.toUpperCase()}
**Seasonality:** ${forecast.seasonalityDetected ? "Detected ✅" : "Not detected"}
**Model Accuracy:** R² = ${forecast.accuracy.r2} | MAPE = ${forecast.accuracy.mape}%

| Month | Predicted | Lower CI | Upper CI | Trend |
|-------|-----------|----------|----------|-------|
${forecast.points.map((p) =>
  `| ${p.period} | $${(p.predicted / 1e3).toFixed(0)}K | $${(p.lower / 1e3).toFixed(0)}K | $${(p.upper / 1e3).toFixed(0)}K | ${p.trend === "up" ? "⬆️" : p.trend === "down" ? "⬇️" : "➡️"} |`
).join("\n")}

### Forecast Insights
${forecast.insights.map((i) => `- ${i}`).join("\n")}

---

## 👥 Customer Segments (RFM Analysis)

${segments.map((s) => `### ${s.label} (${s.size} customers)
- **Avg Revenue:** $${s.avgRevenue.toLocaleString()}
- **Avg Frequency:** ${s.avgFrequency} purchases
- **Recency:** ${s.avgRecency} days since last purchase
- **Recommendation:** ${s.recommendation}
`).join("\n")}

---

## 💡 Strategic Recommendations

1. **Revenue Growth**: ${summary.growthRate > 5 ? "Sustain momentum with upsell campaigns on top products" : "Investigate root causes of growth slowdown; run win-back campaigns"}
2. **Margin Improvement**: ${summary.conversionMetrics.avgDiscount > 15 ? "Reduce average discount by tightening approval thresholds" : "Discount policy is healthy — focus on volume growth"}
3. **Regional Expansion**: Consider increasing investment in ${summary.topRegions[summary.topRegions.length - 1]?.name ?? "underperforming regions"}
4. **Forecast Action**: With a ${forecast.trendDirection} trend, ${forecast.trendDirection === "upward" ? "expand sales capacity proactively" : "review pipeline quality and discount effectiveness"}
5. **Customer Retention**: Focus on "At-Risk" and "Lost" segments with personalised win-back campaigns

---

*Report generated by Predictive Sales Analytics Agent v1.0.0*
`;

            const uri = vscode.Uri.joinPath(
              vscode.workspace.workspaceFolders?.[0]?.uri ?? context.extensionUri,
              `sales-bi-report-${period}.md`
            );
            await vscode.workspace.fs.writeFile(uri, Buffer.from(md, "utf-8"));
            await vscode.window.showTextDocument(uri);
            vscode.window.showInformationMessage("✅ BI Report saved and opened!");
          } catch (err) {
            vscode.window.showErrorMessage(`Report generation failed: ${err}`);
          }
        }
      );
    })
  );

  // ─────────────────────────────────────────────────────
  //  COMMAND: Chat (opens input box for quick queries)
  // ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("salesAgent.chat", async () => {
      const q = await vscode.window.showInputBox({
        placeHolder: "Ask the Sales Agent…",
        prompt:      "E.g. 'What are my top 3 products?' or 'Run a 6-month forecast'",
      });
      if (!q) return;

      const progress: string[] = [];
      const agent = withAgent((msg) => progress.push(msg));

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Sales Agent thinking…", cancellable: false },
        async () => {
          try {
            const response = await agent.chat(q, () => {});
            const doc = await vscode.workspace.openTextDocument({
              content: `# Sales Agent Response\n\n**Query:** ${q}\n\n---\n\n${response}`,
              language: "markdown",
            });
            await vscode.window.showTextDocument(doc);
          } catch (err) {
            vscode.window.showErrorMessage(`Agent error: ${err}`);
          }
        }
      );
    })
  );
}

export function deactivate(): void {
  console.log("[SalesAgent] Extension deactivated");
}

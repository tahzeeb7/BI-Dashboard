// src/providers/dashboardProvider.ts
// ─────────────────────────────────────────────
//  VS Code WebviewPanel with live sales dashboard
//  Uses Chart.js via CDN for visualisations
// ─────────────────────────────────────────────

import * as vscode from "vscode";
import { SalesSummary, ForecastResult, SimulationResult, CustomerCluster } from "../types";

export class DashboardProvider {
  private panel: vscode.WebviewPanel | null = null;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  show(): void {
    if (this.panel) { this.panel.reveal(); return; }

    this.panel = vscode.window.createWebviewPanel(
      "salesDashboard",
      "📊 Sales Analytics Dashboard",
      vscode.ViewColumn.One,
      {
        enableScripts:          true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, "media"),
        ],
      }
    );
    this.panel.onDidDispose(() => { this.panel = null; });
    this.panel.webview.html = this.getBaseHTML();
  }

  updateSummary(summary: SalesSummary): void {
    this.panel?.webview.postMessage({ type: "UPDATE_SUMMARY", data: summary });
  }

  updateForecast(forecast: ForecastResult): void {
    this.panel?.webview.postMessage({ type: "UPDATE_FORECAST", data: forecast });
  }

  updateSimulation(sim: SimulationResult): void {
    this.panel?.webview.postMessage({ type: "UPDATE_SIMULATION", data: sim });
  }

  updateSegments(segments: CustomerCluster[]): void {
    this.panel?.webview.postMessage({ type: "UPDATE_SEGMENTS", data: segments });
  }

  onMessage(handler: (msg: { type: string; data: unknown }) => void): void {
    this.panel?.webview.onDidReceiveMessage(handler);
  }

  private getBaseHTML(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sales Analytics Dashboard</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
  :root {
    --bg:      #0f1117;
    --surface: #1a1d2e;
    --card:    #222540;
    --border:  #2d3154;
    --accent:  #6366f1;
    --accent2: #10b981;
    --accent3: #f59e0b;
    --accent4: #ef4444;
    --text:    #e2e8f0;
    --muted:   #94a3b8;
    --radius:  12px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; min-height: 100vh; }

  .header {
    background: linear-gradient(135deg, #1a1d2e 0%, #222540 100%);
    border-bottom: 1px solid var(--border);
    padding: 16px 24px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .header h1 { font-size: 1.4rem; font-weight: 700; background: linear-gradient(90deg, #6366f1, #10b981); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .header .status { font-size: 0.75rem; color: var(--muted); display: flex; align-items: center; gap: 6px; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent2); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

  .tabs { display: flex; gap: 2px; background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 24px; }
  .tab { padding: 12px 20px; cursor: pointer; font-size: 0.85rem; color: var(--muted); border-bottom: 2px solid transparent; transition: all .2s; user-select: none; }
  .tab.active { color: var(--accent); border-color: var(--accent); }
  .tab:hover:not(.active) { color: var(--text); }

  .pane { display: none; padding: 24px; }
  .pane.active { display: block; }

  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .kpi-card {
    background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 18px; position: relative; overflow: hidden;
  }
  .kpi-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; }
  .kpi-card.green::before  { background: var(--accent2); }
  .kpi-card.blue::before   { background: var(--accent); }
  .kpi-card.amber::before  { background: var(--accent3); }
  .kpi-card.red::before    { background: var(--accent4); }
  .kpi-label { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
  .kpi-value { font-size: 1.6rem; font-weight: 700; line-height: 1; }
  .kpi-badge { display: inline-flex; align-items: center; gap: 3px; font-size: 0.72rem; padding: 2px 7px; border-radius: 20px; margin-top: 6px; }
  .kpi-badge.up   { background: rgba(16,185,129,.15); color: var(--accent2); }
  .kpi-badge.down { background: rgba(239,68,68,.15);  color: var(--accent4); }
  .kpi-badge.flat { background: rgba(99,102,241,.15); color: var(--accent); }

  .chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .chart-grid.full { grid-template-columns: 1fr; }
  .chart-card {
    background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px;
  }
  .chart-title { font-size: 0.85rem; font-weight: 600; color: var(--text); margin-bottom: 14px; }
  .chart-subtitle { font-size: 0.72rem; color: var(--muted); }
  canvas { max-height: 250px; }

  .forecast-banner {
    background: linear-gradient(135deg, rgba(99,102,241,.12), rgba(16,185,129,.12));
    border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 20px;
    margin-bottom: 20px; display: flex; gap: 24px; flex-wrap: wrap;
  }
  .fb-item { }
  .fb-label { font-size: 0.72rem; color: var(--muted); margin-bottom: 3px; }
  .fb-value { font-size: 1.1rem; font-weight: 700; color: var(--accent); }

  .insight-list { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
  .insight-item {
    background: rgba(99,102,241,.07); border-left: 3px solid var(--accent);
    padding: 10px 14px; border-radius: 0 8px 8px 0; font-size: 0.82rem; color: var(--text);
  }

  .sim-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 20px; }
  .sim-metric { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; text-align: center; }
  .sim-label { font-size: 0.72rem; color: var(--muted); margin-bottom: 4px; }
  .sim-baseline { font-size: 0.9rem; color: var(--muted); }
  .sim-projected { font-size: 1.4rem; font-weight: 700; }
  .sim-delta.pos { color: var(--accent2); } .sim-delta.neg { color: var(--accent4); }
  .sim-delta { font-size: 0.8rem; font-weight: 600; }

  .risk-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-top: 8px; }
  .risk-table th { background: var(--surface); color: var(--muted); font-weight: 600; text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); }
  .risk-table td { padding: 8px 12px; border-bottom: 1px solid rgba(45,49,84,.5); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 0.7rem; font-weight: 600; }
  .badge.High   { background: rgba(239,68,68,.2);   color: #f87171; }
  .badge.Medium { background: rgba(245,158,11,.2);  color: #fbbf24; }
  .badge.Low    { background: rgba(16,185,129,.2);  color: #34d399; }

  .seg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .seg-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; }
  .seg-name { font-size: 1rem; font-weight: 700; margin-bottom: 4px; }
  .seg-size { font-size: 0.75rem; color: var(--muted); margin-bottom: 12px; }
  .seg-stat { display: flex; justify-content: space-between; font-size: 0.78rem; padding: 4px 0; border-bottom: 1px solid var(--border); }
  .seg-rec { font-size: 0.75rem; color: var(--accent); margin-top: 10px; font-style: italic; }

  .empty-state { text-align: center; padding: 60px 20px; color: var(--muted); }
  .empty-state .icon { font-size: 3rem; margin-bottom: 12px; }
  .empty-state p { font-size: 0.9rem; }

  .action-btn {
    display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px;
    background: var(--accent); border: none; border-radius: 8px; color: white;
    font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: opacity .2s;
  }
  .action-btn:hover { opacity: 0.85; }
  .action-btn.outline { background: transparent; border: 1px solid var(--accent); color: var(--accent); }
  .btn-row { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
</style>
</head>
<body>

<div class="header">
  <h1>🤖 Predictive Sales Analytics</h1>
  <div class="status"><div class="status-dot"></div><span id="statusText">Awaiting data…</span></div>
</div>

<div class="tabs">
  <div class="tab active" data-pane="overview">📊 Overview</div>
  <div class="tab" data-pane="forecast">📈 Forecast</div>
  <div class="tab" data-pane="simulation">🎯 Strategy Sim</div>
  <div class="tab" data-pane="segments">👥 Segments</div>
</div>

<!-- ── OVERVIEW ── -->
<div class="pane active" id="pane-overview">
  <div id="overview-empty" class="empty-state">
    <div class="icon">📊</div>
    <p>Load sales data using the Chat panel or run <code>Sales Agent: Analyze Sales</code></p>
  </div>
  <div id="overview-content" style="display:none">
    <div class="kpi-grid" id="kpiGrid"></div>
    <div class="chart-grid">
      <div class="chart-card"><div class="chart-title">Revenue by Product</div><canvas id="chartProduct"></canvas></div>
      <div class="chart-card"><div class="chart-title">Revenue by Region</div><canvas id="chartRegion"></canvas></div>
      <div class="chart-card"><div class="chart-title">Monthly Revenue Trend</div><canvas id="chartTrend"></canvas></div>
      <div class="chart-card"><div class="chart-title">Sales by Channel</div><canvas id="chartChannel"></canvas></div>
    </div>
  </div>
</div>

<!-- ── FORECAST ── -->
<div class="pane" id="pane-forecast">
  <div id="forecast-empty" class="empty-state"><div class="icon">📈</div><p>Run a forecast from the Chat panel</p></div>
  <div id="forecast-content" style="display:none">
    <div class="forecast-banner" id="forecastBanner"></div>
    <div class="chart-grid full"><div class="chart-card"><div class="chart-title">Revenue Forecast with Confidence Intervals</div><canvas id="chartForecast"></canvas></div></div>
    <div class="insight-list" id="forecastInsights"></div>
  </div>
</div>

<!-- ── SIMULATION ── -->
<div class="pane" id="pane-simulation">
  <div id="sim-empty" class="empty-state"><div class="icon">🎯</div><p>Run a strategy simulation from the Chat panel</p></div>
  <div id="sim-content" style="display:none">
    <div class="sim-row" id="simMetrics"></div>
    <div class="chart-grid">
      <div class="chart-card"><div class="chart-title">Monthly Revenue Projection</div><canvas id="chartSimRevenue"></canvas></div>
      <div class="chart-card"><div class="chart-title">Cumulative ROI</div><canvas id="chartSimROI"></canvas></div>
    </div>
    <div class="chart-card" style="margin-top:20px">
      <div class="chart-title">Risk Assessment</div>
      <table class="risk-table" id="riskTable"><thead><tr><th>Risk</th><th>Likelihood</th><th>Impact</th></tr></thead><tbody></tbody></table>
    </div>
    <div class="insight-list" id="simRecs"></div>
  </div>
</div>

<!-- ── SEGMENTS ── -->
<div class="pane" id="pane-segments">
  <div id="seg-empty" class="empty-state"><div class="icon">👥</div><p>Run customer segmentation from the Chat panel</p></div>
  <div id="seg-content" style="display:none">
    <div class="chart-grid" style="margin-bottom:20px">
      <div class="chart-card"><div class="chart-title">Segment Distribution</div><canvas id="chartSegDist"></canvas></div>
      <div class="chart-card"><div class="chart-title">Avg Revenue by Segment</div><canvas id="chartSegRev"></canvas></div>
    </div>
    <div class="seg-grid" id="segCards"></div>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
const PALETTE = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899'];
const charts  = {};

function fmt(n) { return n >= 1e6 ? '$'+(n/1e6).toFixed(1)+'M' : n >= 1e3 ? '$'+(n/1e3).toFixed(0)+'K' : '$'+n.toFixed(0); }
function pct(n) { return (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }

// Tab switching
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.pane').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('pane-' + t.dataset.pane).classList.add('active');
  });
});

function makeChart(id, type, labels, datasets, options = {}) {
  if (charts[id]) charts[id].destroy();
  const ctx = document.getElementById(id).getContext('2d');
  charts[id] = new Chart(ctx, {
    type,
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
      scales: type !== 'pie' && type !== 'doughnut' ? {
        x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(45,49,84,.4)' } },
        y: { ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => fmt(v) }, grid: { color: 'rgba(45,49,84,.4)' } },
      } : undefined,
      ...options,
    },
  });
}

// ── Summary update ──────────────────────────────────────
function updateSummary(d) {
  document.getElementById('overview-empty').style.display = 'none';
  document.getElementById('overview-content').style.display = 'block';
  document.getElementById('statusText').textContent = d.totalOrders + ' records loaded';

  const kpis = [
    { label:'Total Revenue', value:fmt(d.totalRevenue), badge:pct(d.growthRate), cls: d.growthRate>=0?'up':'down', color:'green' },
    { label:'Gross Profit',  value:fmt(d.totalProfit),  badge:d.profitMargin+'%', cls:'flat', color:'blue' },
    { label:'Profit Margin', value:d.profitMargin+'%',  badge:'', cls:'flat', color:'blue' },
    { label:'Total Orders',  value:d.totalOrders.toLocaleString(), badge:'AOV '+fmt(d.averageOrderValue), cls:'flat', color:'amber' },
    { label:'Growth Rate',   value:pct(d.growthRate),   badge:'vs prior', cls: d.growthRate>=0?'up':'down', color: d.growthRate>=0?'green':'red' },
    { label:'Avg Discount',  value:d.conversionMetrics.avgDiscount+'%', badge:'', cls:'flat', color:'amber' },
  ];
  document.getElementById('kpiGrid').innerHTML = kpis.map(k =>
    \`<div class="kpi-card \${k.color}">
      <div class="kpi-label">\${k.label}</div>
      <div class="kpi-value">\${k.value}</div>
      \${k.badge ? \`<div class="kpi-badge \${k.cls}">\${k.badge}</div>\` : ''}
    </div>\`
  ).join('');

  // Product doughnut
  const prods = Object.entries(d.revenueByProduct).sort((a,b) => b[1]-a[1]).slice(0,6);
  makeChart('chartProduct','doughnut', prods.map(p=>p[0]), [{data:prods.map(p=>p[1]),backgroundColor:PALETTE,borderWidth:0}]);

  // Region bar
  const regs = Object.entries(d.revenueByRegion).sort((a,b) => b[1]-a[1]);
  makeChart('chartRegion','bar', regs.map(r=>r[0]), [{label:'Revenue',data:regs.map(r=>r[1]),backgroundColor:PALETTE[0]+'cc',borderRadius:6}]);

  // Trend line
  makeChart('chartTrend','line', d.monthlyTrend.map(m=>m.month.substring(5)),
    [{label:'Revenue',data:d.monthlyTrend.map(m=>m.revenue),borderColor:PALETTE[0],backgroundColor:PALETTE[0]+'22',tension:.4,fill:true},
     {label:'Profit', data:d.monthlyTrend.map(m=>m.profit), borderColor:PALETTE[1],backgroundColor:PALETTE[1]+'22',tension:.4,fill:true}]);

  // Channel doughnut
  const chs = Object.entries(d.revenueByChannel);
  makeChart('chartChannel','doughnut', chs.map(c=>c[0]), [{data:chs.map(c=>c[1]),backgroundColor:PALETTE,borderWidth:0}]);
}

// ── Forecast update ─────────────────────────────────────
function updateForecast(d) {
  document.getElementById('forecast-empty').style.display = 'none';
  document.getElementById('forecast-content').style.display = 'block';

  const totalForecast = d.points.reduce((s,p)=>s+p.predicted,0);
  document.getElementById('forecastBanner').innerHTML = [
    {l:'Method', v: d.method.toUpperCase()},
    {l:'Horizon', v: d.horizon + ' months'},
    {l:'Total Forecast', v: fmt(totalForecast)},
    {l:'Trend', v: d.trendDirection.toUpperCase()},
    {l:'Seasonality', v: d.seasonalityDetected ? '✅ Detected' : '—'},
    {l:'MAE', v: fmt(d.accuracy.mae)},
    {l:'R²',  v: d.accuracy.r2},
    {l:'MAPE',v: d.accuracy.mape + '%'},
  ].map(i=>\`<div class="fb-item"><div class="fb-label">\${i.l}</div><div class="fb-value">\${i.v}</div></div>\`).join('');

  makeChart('chartForecast','line', d.points.map(p=>p.period),
    [{label:'Predicted',data:d.points.map(p=>p.predicted),borderColor:PALETTE[0],tension:.3,fill:false,pointRadius:3},
     {label:'Upper CI', data:d.points.map(p=>p.upper),borderColor:PALETTE[0]+'55',backgroundColor:PALETTE[0]+'15',borderDash:[4,4],fill:'+1',pointRadius:0},
     {label:'Lower CI', data:d.points.map(p=>p.lower),borderColor:PALETTE[0]+'55',fill:false,pointRadius:0}]);

  document.getElementById('forecastInsights').innerHTML = d.insights.map(i=>
    \`<div class="insight-item">💡 \${i}</div>\`).join('');
}

// ── Simulation update ───────────────────────────────────
function updateSimulation(d) {
  document.getElementById('sim-empty').style.display = 'none';
  document.getElementById('sim-content').style.display = 'block';

  document.getElementById('simMetrics').innerHTML = [
    {l:'Revenue', base:d.baseline.revenue, proj:d.projected.revenue, delta:d.delta.revenueChangePct},
    {l:'Profit',  base:d.baseline.profit,  proj:d.projected.profit,  delta:d.delta.profitChangePct},
    {l:'ROI',     base:0, proj:d.delta.roi, delta:d.delta.roi, unit:'%'},
  ].map(m => \`<div class="sim-metric">
    <div class="sim-label">\${m.l}</div>
    <div class="sim-projected">\${m.unit === '%' ? m.proj.toFixed(1)+'%' : fmt(m.proj)}</div>
    <div class="sim-baseline">Baseline: \${m.unit === '%' ? '—' : fmt(m.base)}</div>
    <div class="sim-delta \${m.delta>=0?'pos':'neg'}">\${m.delta>=0?'▲':'▼'} \${Math.abs(m.delta).toFixed(1)}%</div>
  </div>\`).join('');

  makeChart('chartSimRevenue','bar', d.monthlyProjection.map(m=>m.month.substring(5)),
    [{label:'Revenue',data:d.monthlyProjection.map(m=>m.revenue),backgroundColor:PALETTE[0]+'aa',borderRadius:4},
     {label:'Profit', data:d.monthlyProjection.map(m=>m.profit),  backgroundColor:PALETTE[1]+'aa',borderRadius:4}]);

  makeChart('chartSimROI','line', d.monthlyProjection.map(m=>m.month.substring(5)),
    [{label:'Cumulative ROI %',data:d.monthlyProjection.map(m=>m.cumulativeROI),borderColor:PALETTE[2],tension:.4,fill:false}],
    { scales: { y: { ticks: { callback: v => v+'%', color:'#94a3b8', font:{size:10} }, grid:{color:'rgba(45,49,84,.4)'} },
                x: { ticks: { color:'#94a3b8', font:{size:10} }, grid:{color:'rgba(45,49,84,.4)'} } } });

  document.querySelector('#riskTable tbody').innerHTML = d.risks.map(r=>
    \`<tr><td>\${r.risk}</td><td><span class="badge \${r.likelihood}">\${r.likelihood}</span></td><td><span class="badge \${r.impact}">\${r.impact}</span></td></tr>\`
  ).join('');

  document.getElementById('simRecs').innerHTML = d.recommendations.map(r=>
    \`<div class="insight-item">🎯 \${r}</div>\`).join('');
}

// ── Segments update ─────────────────────────────────────
function updateSegments(data) {
  document.getElementById('seg-empty').style.display = 'none';
  document.getElementById('seg-content').style.display = 'block';

  makeChart('chartSegDist','doughnut', data.map(s=>s.label),
    [{data:data.map(s=>s.size),backgroundColor:PALETTE,borderWidth:0}]);
  makeChart('chartSegRev','bar', data.map(s=>s.label),
    [{label:'Avg Revenue',data:data.map(s=>s.avgRevenue),backgroundColor:PALETTE,borderRadius:6}]);

  const colors = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6'];
  document.getElementById('segCards').innerHTML = data.map((s,i) => \`
    <div class="seg-card" style="border-top: 3px solid \${colors[i]}">
      <div class="seg-name" style="color:\${colors[i]}">\${s.label}</div>
      <div class="seg-size">\${s.size} customers</div>
      <div class="seg-stat"><span>Avg Revenue</span><strong>\${fmt(s.avgRevenue)}</strong></div>
      <div class="seg-stat"><span>Avg Frequency</span><strong>\${s.avgFrequency}x</strong></div>
      <div class="seg-stat"><span>Recency (days)</span><strong>\${s.avgRecency}d</strong></div>
      <div class="seg-rec">→ \${s.recommendation}</div>
    </div>\`).join('');
}

// Message listener
window.addEventListener('message', ({ data: msg }) => {
  switch (msg.type) {
    case 'UPDATE_SUMMARY':    updateSummary(msg.data);    break;
    case 'UPDATE_FORECAST':   updateForecast(msg.data);   break;
    case 'UPDATE_SIMULATION': updateSimulation(msg.data); break;
    case 'UPDATE_SEGMENTS':   updateSegments(msg.data);   break;
  }
});
</script>
</body>
</html>`;
  }
}

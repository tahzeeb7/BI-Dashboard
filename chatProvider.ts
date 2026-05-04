// src/providers/chatProvider.ts
// ─────────────────────────────────────────────
//  Sidebar webview: chat interface for the AI agent
// ─────────────────────────────────────────────

import * as vscode from "vscode";
import { SalesAgent } from "../agent/salesAgent";
import { computeSalesSummary, performRFMSegmentation } from "../tools/analyticsEngine";
import { runForecast } from "../tools/forecastingEngine";
import { runSimulation, getPresetScenarios } from "../tools/simulationEngine";
import { DashboardProvider } from "./dashboardProvider";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "salesAgent.chatView";
  private view?: vscode.WebviewView;
  private agent?: SalesAgent;
  private dashboard?: DashboardProvider;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  setDashboard(d: DashboardProvider): void { this.dashboard = d; }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html   = this.getChatHTML();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "SEND_MESSAGE") {
        await this.handleUserMessage(msg.text);
      } else if (msg.type === "CLEAR") {
        this.agent?.reset();
        this.postToView({ type: "CLEARED" });
      } else if (msg.type === "QUICK_ACTION") {
        await this.handleUserMessage(msg.text);
      }
    });
  }

  private postToView(msg: object): void {
    this.view?.webview.postMessage(msg);
  }

  private async handleUserMessage(text: string): Promise<void> {
    if (!text.trim()) return;

    // Lazy-init agent
    if (!this.agent) {
      try {
        const { getOrCreateAgent } = await import("../agent/salesAgent");
        this.agent = getOrCreateAgent((progress) => {
          this.postToView({ type: "PROGRESS", text: progress });
        });
      } catch (err) {
        this.postToView({
          type: "ERROR",
          text: err instanceof Error ? err.message : "Failed to initialise agent",
        });
        return;
      }
    }

    this.postToView({ type: "USER_MESSAGE", text });
    this.postToView({ type: "THINKING", show: true });

    let fullResponse = "";
    try {
      fullResponse = await this.agent.chat(text, (chunk) => {
        this.postToView({ type: "CHUNK", text: chunk });
      });
    } catch (err) {
      this.postToView({
        type: "ERROR",
        text: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      this.postToView({ type: "THINKING", show: false });
      this.postToView({ type: "RESPONSE_DONE", text: fullResponse });
    }

    // Auto-update dashboard with latest agent data
    const dataset = this.agent.getCurrentDataset();
    if (dataset && this.dashboard) {
      try {
        const summary = computeSalesSummary(dataset);
        this.dashboard.updateSummary(summary);

        // Auto-update forecast if response mentions forecast
        if (fullResponse.toLowerCase().includes("forecast")) {
          const forecast = runForecast(dataset);
          this.dashboard.updateForecast(forecast);
        }
        // Auto-update segments
        if (fullResponse.toLowerCase().includes("segment")) {
          const segs = performRFMSegmentation(dataset);
          this.dashboard.updateSegments(segs);
        }
        // Auto-update simulation
        if (fullResponse.toLowerCase().includes("simulat") || fullResponse.toLowerCase().includes("strateg")) {
          const summary2 = computeSalesSummary(dataset);
          const presets  = getPresetScenarios(summary2);
          if (presets.length > 0) {
            const sim = runSimulation(dataset, presets[0], summary2);
            this.dashboard.updateSimulation(sim);
          }
        }
      } catch { /* silent */ }
    }
  }

  private getChatHTML(): string {
    return /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--vscode-sideBar-background);
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: 12px;
    height: 100vh; display: flex; flex-direction: column;
  }
  .header {
    padding: 10px 12px; background: var(--vscode-sideBarSectionHeader-background);
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
    display: flex; align-items: center; justify-content: space-between;
  }
  .header-title { font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--vscode-sideBarTitle-foreground); }
  .header-btn { background: none; border: none; color: var(--vscode-foreground); cursor: pointer; opacity: .6; font-size: 14px; }
  .header-btn:hover { opacity: 1; }

  .quick-actions { padding: 8px; display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border); }
  .qa-btn {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 4px; padding: 3px 7px; cursor: pointer; font-size: 10px; white-space: nowrap;
  }
  .qa-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

  .messages { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px; }
  .welcome {
    background: var(--vscode-textBlockQuote-background);
    border-left: 3px solid var(--vscode-textLink-foreground);
    padding: 10px; border-radius: 4px; font-size: 11px; line-height: 1.5;
  }
  .welcome strong { color: var(--vscode-textLink-foreground); }

  .msg { border-radius: 6px; padding: 8px 10px; max-width: 100%; word-break: break-word; line-height: 1.5; font-size: 11.5px; }
  .msg.user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); align-self: flex-end; max-width: 85%; }
  .msg.assistant { background: var(--vscode-textBlockQuote-background); border-left: 2px solid var(--vscode-textLink-foreground); }
  .msg.error { background: var(--vscode-inputValidation-errorBackground); border-left: 2px solid var(--vscode-inputValidation-errorBorder); }
  .msg.progress { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 10.5px; }

  .thinking { display: flex; gap: 4px; align-items: center; padding: 6px 10px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-textLink-foreground); animation: bounce .9s ease-in-out infinite; }
  .dot:nth-child(2) { animation-delay: .15s; }
  .dot:nth-child(3) { animation-delay: .30s; }
  @keyframes bounce { 0%,80%,100% { transform:scale(.8); opacity:.5; } 40% { transform:scale(1.2); opacity:1; } }

  .input-area { padding: 8px; border-top: 1px solid var(--vscode-sideBarSectionHeader-border); display: flex; gap: 6px; align-items: flex-end; }
  textarea {
    flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px;
    padding: 6px 8px; font-size: 11.5px; font-family: inherit; resize: none; outline: none;
    line-height: 1.4; min-height: 36px; max-height: 120px;
  }
  textarea:focus { border-color: var(--vscode-focusBorder); }
  .send-btn {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; border-radius: 4px; padding: 6px 10px; cursor: pointer; font-size: 14px; flex-shrink: 0;
  }
  .send-btn:hover { background: var(--vscode-button-hoverBackground); }
  .send-btn:disabled { opacity: .4; cursor: default; }

  pre, code { font-family: var(--vscode-editor-font-family); font-size: 10.5px; background: rgba(0,0,0,.3); padding: 2px 4px; border-radius: 3px; white-space: pre-wrap; }
</style>
</head>
<body>
<div class="header">
  <span class="header-title">🤖 Sales Agent</span>
  <button class="header-btn" id="clearBtn" title="Clear conversation">🗑</button>
</div>

<div class="quick-actions">
  <button class="qa-btn" data-q="Load synthetic sales data and give me an overview">📂 Load Data</button>
  <button class="qa-btn" data-q="Analyze sales performance and identify top products and regions">📊 Analyze</button>
  <button class="qa-btn" data-q="Run a 12-month ensemble sales forecast with confidence intervals">📈 Forecast</button>
  <button class="qa-btn" data-q="Simulate a 10% price optimization strategy and show the financial impact">🎯 Simulate</button>
  <button class="qa-btn" data-q="Perform customer RFM segmentation analysis">👥 Segments</button>
  <button class="qa-btn" data-q="Generate a comprehensive BI report for the current period">📝 BI Report</button>
  <button class="qa-btn" data-q="Analyze which features most strongly drive revenue">🔬 Features</button>
</div>

<div class="messages" id="messages">
  <div class="welcome">
    <strong>👋 Sales Analytics Agent</strong><br><br>
    I can help you with:<br>
    • 📊 Sales analytics &amp; KPIs<br>
    • 📈 ML forecasting (linear, seasonal, ensemble)<br>
    • 🎯 Strategy simulation (Monte Carlo)<br>
    • 👥 Customer segmentation (RFM)<br>
    • 📝 BI report generation<br><br>
    Use the quick-action buttons above or type your question below.
  </div>
</div>

<div id="thinkingEl" class="thinking" style="display:none">
  <div class="dot"></div><div class="dot"></div><div class="dot"></div>
  <span style="font-size:10px;color:var(--vscode-descriptionForeground);margin-left:4px">Agent thinking…</span>
</div>

<div class="input-area">
  <textarea id="input" rows="1" placeholder="Ask the sales agent anything…"></textarea>
  <button class="send-btn" id="sendBtn">➤</button>
</div>

<script>
const vscode   = acquireVsCodeApi();
const messages = document.getElementById('messages');
const input    = document.getElementById('input');
const sendBtn  = document.getElementById('sendBtn');
const thinking = document.getElementById('thinkingEl');
let   currentAssistantEl = null;
let   isBusy = false;

function scrollBottom() { messages.scrollTop = messages.scrollHeight; }

function addMsg(cls, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + cls;
  el.innerText = text;
  messages.appendChild(el);
  scrollBottom();
  return el;
}

function send() {
  const text = input.value.trim();
  if (!text || isBusy) return;
  vscode.postMessage({ type: 'SEND_MESSAGE', text });
  input.value = '';
  input.style.height = 'auto';
}

input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
sendBtn.addEventListener('click', send);
document.getElementById('clearBtn').addEventListener('click', () => { vscode.postMessage({ type: 'CLEAR' }); });

document.querySelectorAll('.qa-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!isBusy) vscode.postMessage({ type: 'QUICK_ACTION', text: btn.dataset.q });
  });
});

window.addEventListener('message', ({ data: msg }) => {
  switch (msg.type) {
    case 'USER_MESSAGE':
      addMsg('user', msg.text);
      isBusy = true; sendBtn.disabled = true;
      currentAssistantEl = null;
      break;
    case 'THINKING':
      thinking.style.display = msg.show ? 'flex' : 'none';
      if (msg.show) scrollBottom();
      break;
    case 'PROGRESS':
      addMsg('progress', msg.text);
      break;
    case 'CHUNK':
      thinking.style.display = 'none';
      if (!currentAssistantEl) {
        currentAssistantEl = document.createElement('div');
        currentAssistantEl.className = 'msg assistant';
        messages.appendChild(currentAssistantEl);
      }
      currentAssistantEl.innerText += msg.text;
      scrollBottom();
      break;
    case 'RESPONSE_DONE':
      isBusy = false; sendBtn.disabled = false;
      currentAssistantEl = null;
      break;
    case 'ERROR':
      thinking.style.display = 'none';
      addMsg('error', '⚠️ ' + msg.text);
      isBusy = false; sendBtn.disabled = false;
      break;
    case 'CLEARED':
      messages.innerHTML = '<div class="welcome"><strong>Conversation cleared.</strong> Start a new session below.</div>';
      break;
  }
});
</script>
</body>
</html>`;
  }
}

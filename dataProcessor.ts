// src/utils/dataProcessor.ts
// ─────────────────────────────────────────────
//  Parses, validates, and normalises sales data
//  Supports CSV and JSON input files
// ─────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { SalesRecord, SalesDataset } from "../types";

// ── Column alias maps (handles messy real-world headers) ──
const COLUMN_ALIASES: Record<string, string[]> = {
  date:            ["date", "sale_date", "order_date", "transaction_date", "period"],
  product:         ["product", "product_name", "item", "sku", "product_id"],
  region:          ["region", "territory", "area", "location", "market"],
  salesperson:     ["salesperson", "rep", "sales_rep", "agent", "employee"],
  quantity:        ["quantity", "qty", "units", "volume", "count"],
  unitPrice:       ["unit_price", "price", "selling_price", "rate", "unit_cost"],
  revenue:         ["revenue", "sales", "amount", "total", "gross_sales"],
  cost:            ["cost", "cogs", "cost_of_goods", "direct_cost"],
  profit:          ["profit", "net_profit", "gross_profit", "margin_value"],
  channel:         ["channel", "sales_channel", "source", "medium"],
  customerSegment: ["customer_segment", "segment", "customer_type", "tier"],
  discount:        ["discount", "discount_rate", "discount_pct", "promo"],
};

function resolveHeader(header: string): string | null {
  const normalized = header.toLowerCase().replace(/[\s-]/g, "_");
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some((a) => normalized.includes(a))) {
      return field;
    }
  }
  return null;
}

// ── CSV parser (no external dep for simple cases) ────────
function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    // Handle quoted fields containing commas
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of lines[i]) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === "," && !inQuotes) { values.push(current.trim()); current = ""; }
      else { current += char; }
    }
    values.push(current.trim());

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ""; });
    rows.push(row);
  }
  return rows;
}

function mapRowToRecord(row: Record<string, string>): SalesRecord | null {
  const mapped: Partial<Record<string, string | number>> = {};

  for (const [rawKey, rawVal] of Object.entries(row)) {
    const field = resolveHeader(rawKey);
    if (field) {
      const numericFields = ["quantity", "unitPrice", "revenue", "cost", "profit", "discount"];
      mapped[field] = numericFields.includes(field)
        ? parseFloat(rawVal.replace(/[$,\s%]/g, "")) || 0
        : rawVal;
    }
  }

  // Require minimum fields
  if (!mapped.date || !mapped.revenue) return null;

  // Derive missing fields
  const revenue = (mapped.revenue as number) || 0;
  const cost    = (mapped.cost as number) || revenue * 0.6;
  const qty     = (mapped.quantity as number) || 1;

  return {
    date:            String(mapped.date || ""),
    product:         String(mapped.product || "Unknown"),
    region:          String(mapped.region || "Global"),
    salesperson:     String(mapped.salesperson || "Unknown"),
    quantity:        qty,
    unitPrice:       (mapped.unitPrice as number) || revenue / qty,
    revenue,
    cost,
    profit:          (mapped.profit as number) || revenue - cost,
    channel:         String(mapped.channel || "Direct"),
    customerSegment: String(mapped.customerSegment || "General"),
    discount:        (mapped.discount as number) || 0,
  };
}

// ── Generate synthetic dataset for demo ──────────────────
export function generateSyntheticData(months: number = 24): SalesDataset {
  const products   = ["ProSuite X", "DataCore Pro", "AnalyticsHub", "SalesBoost", "CloudCRM"];
  const regions    = ["North America", "Europe", "Asia Pacific", "Latin America", "Middle East"];
  const channels   = ["Direct", "Partner", "Online", "Reseller", "Enterprise"];
  const segments   = ["Enterprise", "SMB", "Startup", "Government", "Education"];
  const salespeople = ["Alice Chen", "Bob Martinez", "Carol Singh", "David Kim", "Eva Brown"];

  const records: SalesRecord[] = [];
  const now = new Date();

  const basePrices: Record<string, number> = {
    "ProSuite X": 2500, "DataCore Pro": 1800, "AnalyticsHub": 3200,
    "SalesBoost": 1200, "CloudCRM": 950,
  };
  const regionMultiplier: Record<string, number> = {
    "North America": 1.0, "Europe": 0.85, "Asia Pacific": 0.75,
    "Latin America": 0.6, "Middle East": 0.7,
  };

  for (let m = months - 1; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const seasonality = 1 + 0.2 * Math.sin((d.getMonth() / 12) * 2 * Math.PI);
    const trend = 1 + (months - m) * 0.008; // 0.8% monthly growth

    for (const product of products) {
      const ordersThisMonth = Math.floor(8 + Math.random() * 15);
      for (let o = 0; o < ordersThisMonth; o++) {
        const region   = regions[Math.floor(Math.random() * regions.length)];
        const channel  = channels[Math.floor(Math.random() * channels.length)];
        const segment  = segments[Math.floor(Math.random() * segments.length)];
        const rep      = salespeople[Math.floor(Math.random() * salespeople.length)];
        const qty      = Math.floor(1 + Math.random() * 5);
        const discount = Math.random() < 0.3 ? Math.random() * 0.2 : 0;
        const price    = basePrices[product] * regionMultiplier[region] * seasonality * trend;
        const revenue  = qty * price * (1 - discount);
        const cost     = revenue * (0.55 + Math.random() * 0.1);

        records.push({
          date: monthStr + `-${String(Math.floor(1 + Math.random() * 28)).padStart(2, "0")}`,
          product, region, salesperson: rep, quantity: qty,
          unitPrice: Math.round(price * 100) / 100,
          revenue: Math.round(revenue * 100) / 100,
          cost: Math.round(cost * 100) / 100,
          profit: Math.round((revenue - cost) * 100) / 100,
          channel, customerSegment: segment,
          discount: Math.round(discount * 100) / 100,
        });
      }
    }
  }

  return buildDataset(records);
}

function buildDataset(records: SalesRecord[]): SalesDataset {
  const dates = records.map((r) => r.date).sort();
  return {
    records,
    metadata: {
      totalRecords: records.length,
      dateRange: { from: dates[0], to: dates[dates.length - 1] },
      products:  [...new Set(records.map((r) => r.product))],
      regions:   [...new Set(records.map((r) => r.region))],
      channels:  [...new Set(records.map((r) => r.channel))],
      segments:  [...new Set(records.map((r) => r.customerSegment))],
    },
  };
}

// ── Public API ────────────────────────────────────────────
export function loadSalesData(filePath: string): SalesDataset {
  const ext     = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, "utf-8");

  let records: SalesRecord[] = [];

  if (ext === ".csv") {
    const rows = parseCSV(content);
    records = rows.map(mapRowToRecord).filter((r): r is SalesRecord => r !== null);
  } else if (ext === ".json") {
    const json = JSON.parse(content);
    const arr  = Array.isArray(json) ? json : json.records ?? json.data ?? [];
    records = arr.map(mapRowToRecord).filter((r): r is SalesRecord => r !== null);
  } else {
    throw new Error(`Unsupported file type: ${ext}. Use .csv or .json`);
  }

  if (records.length === 0) throw new Error("No valid sales records found in file.");
  return buildDataset(records);
}

export function getMonthlyTimeSeries(dataset: SalesDataset): Array<{ month: string; revenue: number; profit: number; volume: number }> {
  const grouped: Record<string, { revenue: number; profit: number; volume: number }> = {};

  for (const r of dataset.records) {
    const month = r.date.substring(0, 7); // YYYY-MM
    if (!grouped[month]) grouped[month] = { revenue: 0, profit: 0, volume: 0 };
    grouped[month].revenue += r.revenue;
    grouped[month].profit  += r.profit;
    grouped[month].volume  += r.quantity;
  }

  return Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));
}

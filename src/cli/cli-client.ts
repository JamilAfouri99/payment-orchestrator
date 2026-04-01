import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface CliConfig {
  apiKey: string;
  baseUrl: string;
}

export interface CliError {
  code: string;
  message: string;
}

const CONFIG_DIR = join(homedir(), ".payorchestrate");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function loadConfig(): CliConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as CliConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: CliConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

async function apiRequest(
  config: CliConfig,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const url = `${config.baseUrl}${path}`;
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  const response = await fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const data = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const detail = (data as { detail?: string }).detail ?? response.statusText;
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }

  return data;
}

export async function listPayments(config: CliConfig, limit: number = 20): Promise<unknown> {
  return apiRequest(config, "GET", `/payments?limit=${limit}`);
}

export async function getPayment(config: CliConfig, id: string): Promise<unknown> {
  return apiRequest(config, "GET", `/payments/${id}`);
}

export async function createPayment(
  config: CliConfig,
  amount: number,
  currency: string,
  customerId: string = "cli_customer",
): Promise<unknown> {
  const idempotencyKey = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const url = `${config.baseUrl}/payments`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      amount,
      currency,
      customerId,
      orderId: `cli_order_${Date.now()}`,
      items: [{ productId: "cli_product", quantity: 1, pricePerUnit: amount }],
    }),
  });

  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(data as { detail?: string }).detail ?? response.statusText}`);
  }
  return data;
}

export async function listTestCards(config: CliConfig): Promise<unknown> {
  return apiRequest(config, "GET", "/admin/sandbox/test-cards");
}

export async function triggerDispute(config: CliConfig, paymentId: string): Promise<unknown> {
  return apiRequest(config, "POST", "/admin/sandbox/trigger-dispute", { paymentId });
}

export async function getLogs(config: CliConfig, limit: number = 50): Promise<unknown> {
  return apiRequest(config, "GET", `/admin/logs?limit=${limit}`);
}

export async function registerWebhook(config: CliConfig, url: string, events: string[] = ["*"]): Promise<unknown> {
  return apiRequest(config, "POST", "/webhooks/register", { url, events });
}

export async function listWebhookDeliveries(config: CliConfig): Promise<unknown> {
  return apiRequest(config, "GET", "/webhooks/deliveries");
}

export function parseArgs(argv: string[]): { command: string; subcommand: string; flags: Record<string, string> } {
  const args = argv.slice(2);
  const command = args[0] ?? "help";
  const subcommand = args[1] ?? "";
  const flags: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1] ?? "true";
      if (!value.startsWith("--")) {
        flags[key] = value;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }

  return { command, subcommand, flags };
}

export function formatTable(rows: Record<string, unknown>[], columns: string[]): string {
  if (rows.length === 0) return "No results.";

  const widths = columns.map((col) => {
    const values = rows.map((r) => String(r[col] ?? "").length);
    return Math.max(col.length, ...values);
  });

  const header = columns.map((col, i) => col.padEnd(widths[i]!)).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows.map((row) =>
    columns.map((col, i) => String(row[col] ?? "").padEnd(widths[i]!)).join("  "),
  );

  return [header, separator, ...body].join("\n");
}

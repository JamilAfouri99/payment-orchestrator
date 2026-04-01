#!/usr/bin/env npx tsx
/**
 * Payment Orchestrator CLI
 *
 * Usage: npx tsx bin/payorchestrate.ts <command> [subcommand] [flags]
 *
 * Commands:
 *   login                          Store API key for authentication
 *   payments list                  List recent payments
 *   payments create                Create a new payment
 *   payments get <id>              Get payment details
 *   webhooks listen                Register webhook and poll for deliveries
 *   logs tail                      Stream recent structured logs
 *   sandbox test-cards             Show test card reference
 *   sandbox trigger-dispute        Trigger a dispute on a sandbox payment
 *   help                           Show this help message
 */

import {
  loadConfig,
  saveConfig,
  getConfigPath,
  parseArgs,
  formatTable,
  listPayments,
  getPayment,
  createPayment,
  listTestCards,
  triggerDispute,
  getLogs,
  registerWebhook,
  listWebhookDeliveries,
} from "../src/cli/cli-client.js";
import type { CliConfig } from "../src/cli/cli-client.js";
import { createInterface } from "readline";

const { command, subcommand, flags } = parseArgs(process.argv);

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function requireConfig(): CliConfig {
  const config = loadConfig();
  if (!config) {
    console.error("Not logged in. Run: npx tsx bin/payorchestrate.ts login");
    process.exit(1);
  }
  return config;
}

async function handleLogin(): Promise<void> {
  const apiKey = flags["key"] ?? (await prompt("API Key: "));
  const baseUrl = flags["url"] ?? "http://localhost:3000";

  if (!apiKey) {
    console.error("API key is required.");
    process.exit(1);
  }

  saveConfig({ apiKey, baseUrl });
  console.log(`Credentials saved to ${getConfigPath()}`);
  console.log(`  Base URL: ${baseUrl}`);
  console.log(`  API Key:  ${apiKey.slice(0, 12)}...`);
}

async function handlePayments(): Promise<void> {
  const config = requireConfig();

  switch (subcommand) {
    case "list": {
      const limit = parseInt(flags["limit"] ?? "20", 10);
      const result = (await listPayments(config, limit)) as { payments?: Record<string, unknown>[] };
      const payments = result.payments ?? [];
      if (payments.length === 0) {
        console.log("No payments found.");
        return;
      }
      console.log(formatTable(payments, ["id", "status", "amount", "currency", "customerId", "createdAt"]));
      break;
    }

    case "create": {
      const amount = parseInt(flags["amount"] ?? "1000", 10);
      const currency = flags["currency"] ?? "USD";
      const customerId = flags["customer"] ?? "cli_customer";
      console.log(`Creating payment: ${amount} ${currency}...`);
      const payment = (await createPayment(config, amount, currency, customerId)) as Record<string, unknown>;
      console.log(`Payment created: ${payment["id"]} (${payment["status"]})`);
      break;
    }

    case "get": {
      const id = flags["id"] ?? process.argv[4];
      if (!id) {
        console.error("Payment ID required. Usage: payments get <id>");
        process.exit(1);
      }
      const payment = (await getPayment(config, id)) as Record<string, unknown>;
      console.log(JSON.stringify(payment, null, 2));
      break;
    }

    default:
      console.error(`Unknown payments subcommand: ${subcommand}`);
      console.error("Available: list, create, get");
      process.exit(1);
  }
}

async function handleWebhooks(): Promise<void> {
  const config = requireConfig();

  if (subcommand !== "listen") {
    console.error("Available webhooks subcommands: listen");
    process.exit(1);
  }

  const port = parseInt(flags["port"] ?? "4000", 10);
  const callbackUrl = flags["url"] ?? `http://localhost:${port}/webhook`;

  console.log(`Registering webhook for: ${callbackUrl}`);
  const reg = (await registerWebhook(config, callbackUrl)) as { id?: string };
  console.log(`Webhook registered: ${reg.id}`);
  console.log("Polling for deliveries... (Ctrl+C to stop)\n");

  const seen = new Set<string>();
  const poll = async (): Promise<void> => {
    try {
      const deliveries = (await listWebhookDeliveries(config)) as Record<string, unknown>[];
      const items = Array.isArray(deliveries) ? deliveries : [];
      for (const d of items) {
        const id = String(d["id"] ?? "");
        if (!seen.has(id)) {
          seen.add(id);
          const timestamp = new Date(String(d["createdAt"] ?? "")).toLocaleTimeString();
          console.log(`[${timestamp}] ${d["eventType"]} → ${d["status"]}`);
        }
      }
    } catch {
      // Ignore polling errors
    }
  };

  // Initial fetch + 3-second interval
  await poll();
  const interval = setInterval(() => void poll(), 3000);
  process.on("SIGINT", () => {
    clearInterval(interval);
    console.log("\nStopped listening.");
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}

async function handleLogs(): Promise<void> {
  const config = requireConfig();

  if (subcommand !== "tail" && subcommand !== "") {
    console.error("Available logs subcommands: tail");
    process.exit(1);
  }

  const limit = parseInt(flags["limit"] ?? "50", 10);
  console.log(`Streaming last ${limit} logs... (Ctrl+C to stop)\n`);

  const seen = new Set<string>();
  const poll = async (): Promise<void> => {
    try {
      const result = (await getLogs(config, limit)) as { logs?: Record<string, unknown>[] };
      const logs = result.logs ?? [];
      for (const log of logs) {
        const key = `${log["timestamp"]}_${log["event"]}`;
        if (!seen.has(key)) {
          seen.add(key);
          const ts = String(log["timestamp"] ?? "").slice(11, 23);
          const level = String(log["level"] ?? "info").toUpperCase().padEnd(5);
          console.log(`${ts} ${level} ${log["event"]} ${JSON.stringify(log["data"] ?? {})}`);
        }
      }
    } catch {
      // Ignore polling errors
    }
  };

  await poll();
  const interval = setInterval(() => void poll(), 3000);
  process.on("SIGINT", () => {
    clearInterval(interval);
    console.log("\nStopped tailing.");
    process.exit(0);
  });

  await new Promise(() => {});
}

async function handleSandbox(): Promise<void> {
  const config = requireConfig();

  switch (subcommand) {
    case "test-cards": {
      const result = (await listTestCards(config)) as { cards?: Record<string, unknown>[] };
      const cards = result.cards ?? [];
      console.log("\nTest Card Reference\n");
      console.log(formatTable(cards, ["number", "behavior", "description"]));
      console.log();
      break;
    }

    case "trigger-dispute": {
      const paymentId = flags["payment"] ?? process.argv[4];
      if (!paymentId) {
        console.error("Payment ID required. Usage: sandbox trigger-dispute --payment <id>");
        process.exit(1);
      }
      const result = (await triggerDispute(config, paymentId)) as { disputeId?: string };
      console.log(`Dispute triggered: ${result.disputeId}`);
      break;
    }

    default:
      console.error(`Unknown sandbox subcommand: ${subcommand}`);
      console.error("Available: test-cards, trigger-dispute");
      process.exit(1);
  }
}

function showHelp(): void {
  console.log(`
Payment Orchestrator CLI

Usage: npx tsx bin/payorchestrate.ts <command> [subcommand] [flags]

Commands:
  login                              Store API key
    --key <api-key>                  API key (or enter interactively)
    --url <base-url>                 API base URL (default: http://localhost:3000)

  payments list                      List recent payments
    --limit <n>                      Max results (default: 20)

  payments create                    Create a new payment
    --amount <cents>                 Amount in cents (default: 1000)
    --currency <code>                Currency code (default: USD)
    --customer <id>                  Customer ID (default: cli_customer)

  payments get <id>                  Get payment details
    --id <payment-id>                Payment ID

  webhooks listen                    Poll for webhook deliveries
    --url <callback-url>             Callback URL to register
    --port <port>                    Local port (default: 4000)

  logs tail                          Stream structured logs
    --limit <n>                      Number of log entries (default: 50)

  sandbox test-cards                 Show test card reference
  sandbox trigger-dispute            Trigger dispute on sandbox payment
    --payment <id>                   Payment ID

  help                               Show this help message

Examples:
  npx tsx bin/payorchestrate.ts login --key pk_test_abc123
  npx tsx bin/payorchestrate.ts payments create --amount 5000 --currency USD
  npx tsx bin/payorchestrate.ts payments list --limit 10
  npx tsx bin/payorchestrate.ts webhooks listen
  npx tsx bin/payorchestrate.ts logs tail
  npx tsx bin/payorchestrate.ts sandbox test-cards
`);
}

async function main(): Promise<void> {
  try {
    switch (command) {
      case "login":
        await handleLogin();
        break;
      case "payments":
        await handlePayments();
        break;
      case "webhooks":
        await handleWebhooks();
        break;
      case "logs":
        await handleLogs();
        break;
      case "sandbox":
        await handleSandbox();
        break;
      case "help":
      case "--help":
      case "-h":
        showHelp();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

void main();

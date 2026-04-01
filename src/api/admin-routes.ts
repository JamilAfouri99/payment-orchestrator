import { Router, type Request, type Response } from "express";
import type { ChaosController } from "../chaos/chaos-controller.js";
import type { CircuitBreakerRegistry } from "../circuit-breaker/circuit-breaker-registry.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";
import type { Logger } from "../core/logger.js";
import type { Bulkhead } from "../bulkhead/bulkhead.js";
import type { PrismaClient } from "@prisma/client";
import type { ProviderRegistry } from "../routing/provider-registry.js";
import type { RoutingEngine } from "../routing/routing-engine.js";
import type { FxService } from "../fx/fx-service.js";
import type { RetryStrategy } from "../retry/retry-strategy.js";
import type { PaymentService } from "./payment-service.js";
import { getRecentLogs } from "../core/logger.js";
import { recoverIncompleteSagas } from "../saga/saga-recovery.js";
import { signPayload, verifySignature } from "../webhooks/webhook-delivery.js";
import { getAllDeclineCodes } from "../retry/decline-codes.js";
import { DEFAULT_TENANT_ID } from "../tenancy/tenant-context.js";
import type { QueueService, QueueName } from "../queue/queue-service.js";
import { ALL_QUEUE_NAMES } from "../queue/queue-service.js";

export interface AdminRouteDeps {
  chaos: ChaosController;
  cbRegistry: CircuitBreakerRegistry;
  metrics: MetricsCollector;
  logger: Logger;
  bulkheads: Bulkhead[];
  prisma: PrismaClient;
  webhookSecret: string;
  providerRegistry: ProviderRegistry;
  routingEngine: RoutingEngine;
  fxService: FxService;
  retryStrategy: RetryStrategy;
  paymentService: PaymentService;
  queueService?: QueueService | undefined;
}

export function createAdminRoutes(deps: AdminRouteDeps): Router {
  const router = Router();

  // --- Chaos Engineering ---

  router.get("/admin/chaos", (_req: Request, res: Response) => {
    res.json({ services: deps.chaos.getAll() });
  });

  router.post("/admin/chaos", (req: Request, res: Response) => {
    const { service, failureRate, latencyMs, enabled } = req.body as {
      service?: string; failureRate?: number; latencyMs?: number; enabled?: boolean;
    };
    if (!service) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "Service name required" });
      return;
    }
    deps.chaos.setConfig(service, {
      ...(failureRate !== undefined ? { failureRate } : {}),
      ...(latencyMs !== undefined ? { latencyMs } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    });
    deps.logger.info("chaos_config_updated", { service, failureRate, latencyMs, enabled });
    res.json({ services: deps.chaos.getAll() });
  });

  router.post("/admin/chaos/reset", (_req: Request, res: Response) => {
    deps.chaos.reset();
    deps.logger.info("chaos_config_reset");
    res.json({ success: true, services: deps.chaos.getAll() });
  });

  // --- Circuit Breakers ---

  router.get("/admin/circuit-breakers", (_req: Request, res: Response) => {
    res.json({ breakers: deps.cbRegistry.getAll() });
  });

  router.post("/admin/circuit-breakers/:name/reset", (req: Request, res: Response) => {
    const name = String(req.params["name"]);
    const success = deps.cbRegistry.reset(name);
    if (!success) {
      res.status(404).json({ type: "not_found", title: "Not Found", status: 404, detail: `Circuit breaker "${name}" not found` });
      return;
    }
    deps.logger.info("circuit_breaker_reset", { name });
    res.json({ success: true });
  });

  // --- Metrics ---

  router.get("/admin/metrics", (_req: Request, res: Response) => {
    res.json(deps.metrics.snapshot());
  });

  router.post("/admin/metrics/reset", (_req: Request, res: Response) => {
    deps.metrics.reset();
    res.json({ success: true });
  });

  // --- Logs ---

  router.get("/admin/logs", (req: Request, res: Response) => {
    const limit = parseInt(String(req.query["limit"] ?? "100"), 10);
    res.json({ logs: getRecentLogs(limit) });
  });

  // --- Bulkheads ---

  router.get("/admin/bulkheads", (_req: Request, res: Response) => {
    res.json({ bulkheads: deps.bulkheads.map((b) => b.getStats()) });
  });

  // --- Saga Recovery ---

  router.post("/admin/saga-recovery", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId;
    const result = await recoverIncompleteSagas(deps.prisma, deps.logger, tenantId);
    res.json(result);
  });

  // --- Webhook Verification ---

  router.post("/webhooks/verify", (req: Request, res: Response) => {
    const { payload, signature, secret } = req.body as {
      payload?: string; signature?: string; secret?: string;
    };
    if (!payload || !signature) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "payload and signature are required" });
      return;
    }
    const secretToUse = secret ?? deps.webhookSecret;
    const computedSignature = signPayload(payload, secretToUse);
    const valid = verifySignature(payload, signature, secretToUse);
    res.json({ valid, computedSignature, providedSignature: signature });
  });

  // --- Provider Management ---

  router.get("/admin/providers", (_req: Request, res: Response) => {
    const configs = deps.providerRegistry.getAllConfigs();
    const breakers = deps.cbRegistry.getAll();
    const providers = configs.map((c) => ({
      ...c,
      circuitBreaker: breakers.find((b) => b.name === c.name)?.state ?? "unknown",
    }));
    res.json({ providers });
  });

  router.get("/admin/providers/:name/metrics", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const name = String(req.params["name"]);
    const windowMs = parseInt(String(req.query["window"] ?? "3600000"), 10);
    const result = await deps.paymentService.getProviderMetrics(tenantId).getStats(name, windowMs);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Metrics Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/providers/metrics", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const windowMs = parseInt(String(req.query["window"] ?? "3600000"), 10);
    const result = await deps.paymentService.getProviderMetrics(tenantId).getAllStats(windowMs);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Metrics Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ stats: result.value });
  });

  router.get("/admin/routing/simulate", async (req: Request, res: Response) => {
    const amount = parseInt(String(req.query["amount"] ?? "1000"), 10);
    const currency = String(req.query["currency"] ?? "USD");
    const region = String(req.query["region"] ?? "US");
    const customerId = String(req.query["customerId"] ?? "sim_customer");

    const result = await deps.routingEngine.simulateRouting({ amount, currency, region, customerId });
    if (!result.ok) {
      res.status(422).json({ type: "routing_error", title: "Routing Failed", status: 422, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  // --- Fraud Rules ---

  router.get("/admin/fraud/rules", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const result = await deps.paymentService.getFraudEngine(tenantId).getRules();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Fraud Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ rules: result.value });
  });

  router.post("/admin/fraud/rules", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const body = req.body as { name?: string; description?: string; ruleType?: string; config?: Record<string, unknown>; weight?: number; enabled?: boolean; id?: string };
    if (!body.name || !body.ruleType) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "name and ruleType are required" });
      return;
    }
    const result = await deps.paymentService.getFraudEngine(tenantId).upsertRule({
      id: body.id,
      name: body.name,
      description: body.description ?? "",
      ruleType: body.ruleType,
      config: body.config ?? {},
      weight: body.weight ?? 10,
      enabled: body.enabled ?? true,
    });
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Fraud Error", status: 500, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.put("/admin/fraud/rules/:id", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const body = req.body as { name?: string; description?: string; ruleType?: string; config?: Record<string, unknown>; weight?: number; enabled?: boolean };
    const result = await deps.paymentService.getFraudEngine(tenantId).upsertRule({
      id: String(req.params["id"]),
      name: body.name ?? "",
      description: body.description ?? "",
      ruleType: body.ruleType ?? "",
      config: body.config ?? {},
      weight: body.weight ?? 10,
      enabled: body.enabled ?? true,
    });
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Fraud Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.delete("/admin/fraud/rules/:id", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const result = await deps.paymentService.getFraudEngine(tenantId).deleteRule(String(req.params["id"]));
    if (!result.ok) {
      res.status(404).json({ type: "not_found", title: "Not Found", status: 404, detail: result.error.message });
      return;
    }
    res.json({ success: true });
  });

  router.get("/payments/:id/fraud", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const result = await deps.paymentService.getFraudEngine(tenantId).getEvaluation(String(req.params["id"]));
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Fraud Error", status: 500, detail: result.error.message });
      return;
    }
    if (!result.value) {
      res.status(404).json({ type: "not_found", title: "Not Found", status: 404, detail: "No fraud evaluation found" });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/fraud/simulate", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const body = req.body as {
      amount?: number; currency?: string; customerId?: string; region?: string;
      customerPaymentCount?: number; customerAvgAmount?: number;
    };
    const result = await deps.paymentService.getFraudEngine(tenantId).evaluate(
      { amount: body.amount ?? 1000, currency: body.currency ?? "USD", customerId: body.customerId ?? "sim", orderId: "sim", items: [{ productId: "sim", quantity: 1, pricePerUnit: body.amount ?? 1000 }], region: body.region },
      { customerPaymentCount: body.customerPaymentCount ?? 0, customerAvgAmount: body.customerAvgAmount ?? 0, customerRegion: body.region ?? "US" },
    );
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Fraud Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  // --- Tokens ---

  router.get("/tokens", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const customerId = String(req.query["customerId"] ?? "");
    if (!customerId) {
      try {
        const tokens = await deps.prisma.paymentToken.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          take: 100,
        });
        res.json({ tokens });
      } catch {
        res.status(500).json({ type: "error", title: "Token Error", status: 500, detail: "Failed to list tokens" });
      }
      return;
    }
    const result = await deps.paymentService.getTokenVault(tenantId).listByCustomer(customerId);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Token Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ tokens: result.value });
  });

  router.get("/tokens/:token", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const result = await deps.paymentService.getTokenVault(tenantId).getToken(String(req.params["token"]));
    if (!result.ok) {
      res.status(404).json({ type: "not_found", title: "Not Found", status: 404, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/tokens/revoke/:token", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const result = await deps.paymentService.getTokenVault(tenantId).revokeToken(String(req.params["token"]));
    if (!result.ok) {
      res.status(404).json({ type: "not_found", title: "Not Found", status: 404, detail: result.error.message });
      return;
    }
    res.json({ success: true });
  });

  // --- FX Rates ---

  router.get("/admin/fx/rates", (_req: Request, res: Response) => {
    res.json({ rates: deps.fxService.getAllRates() });
  });

  router.post("/admin/fx/rates", (req: Request, res: Response) => {
    const { from, to, rate, spreadBps } = req.body as { from?: string; to?: string; rate?: number; spreadBps?: number };
    if (!from || !to || rate === undefined) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "from, to, and rate are required" });
      return;
    }
    deps.fxService.setRate(from, to, rate, spreadBps ?? 50);
    res.json({ success: true, rates: deps.fxService.getAllRates() });
  });

  // --- Decline Codes ---

  router.get("/admin/decline-codes", (_req: Request, res: Response) => {
    res.json({ codes: getAllDeclineCodes() });
  });

  // --- Retry History ---

  router.get("/payments/:id/retries", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    try {
      const retries = await deps.prisma.paymentRetry.findMany({
        where: { tenantId, paymentId: String(req.params["id"]) },
        orderBy: { createdAt: "desc" },
      });
      res.json({ retries });
    } catch {
      res.status(500).json({ type: "error", title: "Error", status: 500, detail: "Failed to fetch retries" });
    }
  });

  // --- Ledger ---

  router.get("/admin/ledger/accounts", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const ledger = deps.paymentService.getLedgerService(tenantId);
    const result = await ledger.listAccounts();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Ledger Error", status: 500, detail: result.error.message });
      return;
    }

    // Compute balances for each account
    const accountsWithBalances = [];
    for (const account of result.value) {
      const balanceResult = await ledger.getBalance(account.id);
      accountsWithBalances.push({
        ...account,
        balance: balanceResult.ok ? balanceResult.value.balance : 0,
      });
    }

    res.json({ accounts: accountsWithBalances });
  });

  router.get("/admin/ledger/accounts/:id/balance", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const ledger = deps.paymentService.getLedgerService(tenantId);
    const asOf = req.query["asOf"] ? new Date(String(req.query["asOf"])) : undefined;
    const result = await ledger.getBalance(String(req.params["id"]), asOf);
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Ledger Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/ledger/accounts/:id/statement", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const ledger = deps.paymentService.getLedgerService(tenantId);
    const from = req.query["from"] ? new Date(String(req.query["from"])) : new Date(Date.now() - 30 * 86_400_000);
    const to = req.query["to"] ? new Date(String(req.query["to"])) : new Date();
    const result = await ledger.getStatement(String(req.params["id"]), from, to);
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Ledger Error", status, detail: result.error.message });
      return;
    }
    res.json({ entries: result.value });
  });

  router.get("/admin/ledger/transactions", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const ledger = deps.paymentService.getLedgerService(tenantId);
    const limit = parseInt(String(req.query["limit"] ?? "50"), 10);
    const offset = parseInt(String(req.query["offset"] ?? "0"), 10);
    const result = await ledger.listTransactions(limit, offset);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Ledger Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/ledger/transactions/:id", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const ledger = deps.paymentService.getLedgerService(tenantId);
    const result = await ledger.getTransaction(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Ledger Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/ledger/reconcile", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const ledger = deps.paymentService.getLedgerService(tenantId);
    const result = await ledger.reconcile();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Ledger Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  // --- Settlements ---

  router.get("/admin/settlements", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const settlement = deps.paymentService.getSettlementService(tenantId);
    const limit = parseInt(String(req.query["limit"] ?? "50"), 10);
    const offset = parseInt(String(req.query["offset"] ?? "0"), 10);
    const result = await settlement.listSettlements(limit, offset);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Settlement Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/settlements/calculate", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const settlement = deps.paymentService.getSettlementService(tenantId);
    const body = req.body as {
      merchantAccountId?: string;
      periodStart?: string;
      periodEnd?: string;
      currency?: string;
      payoutMethod?: string;
    };

    if (!body.merchantAccountId || !body.periodStart || !body.periodEnd) {
      res.status(400).json({
        type: "validation", title: "Bad Request", status: 400,
        detail: "merchantAccountId, periodStart, and periodEnd are required",
      });
      return;
    }

    const result = await settlement.calculateSettlement(
      body.merchantAccountId,
      new Date(body.periodStart),
      new Date(body.periodEnd),
      body.currency,
      body.payoutMethod as "bank_transfer" | "wallet" | undefined,
    );
    if (!result.ok) {
      res.status(422).json({ type: "error", title: "Calculation Failed", status: 422, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.get("/admin/settlements/:id", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const settlement = deps.paymentService.getSettlementService(tenantId);
    const result = await settlement.getSettlement(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Settlement Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/settlements/:id/approve", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const settlement = deps.paymentService.getSettlementService(tenantId);
    const result = await settlement.approveSettlement(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : result.error.code === "INVALID_STATUS" ? 409 : 500;
      res.status(status).json({ type: "error", title: "Settlement Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/settlements/:id/process", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const settlement = deps.paymentService.getSettlementService(tenantId);
    const result = await settlement.processSettlement(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : result.error.code === "INVALID_STATUS" ? 409 : 500;
      res.status(status).json({ type: "error", title: "Settlement Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/settlements/:id/report", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const settlement = deps.paymentService.getSettlementService(tenantId);
    const result = await settlement.generateReport(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Settlement Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/settlements/:id/export", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const settlement = deps.paymentService.getSettlementService(tenantId);
    const result = await settlement.exportCsv(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Settlement Error", status, detail: result.error.message });
      return;
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=settlement-${String(req.params["id"])}.csv`);
    res.send(result.value);
  });

  // --- Subscription Plans ---

  router.post("/admin/subscriptions/plans", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const body = req.body as {
      name?: string; description?: string; billingInterval?: string;
      amount?: number; currency?: string; trialDays?: number;
      features?: string[]; metadata?: Record<string, unknown>;
    };
    if (!body.name || !body.billingInterval || !body.amount) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "name, billingInterval, and amount are required" });
      return;
    }
    const result = await svc.createPlan({
      name: body.name,
      description: body.description,
      billingInterval: body.billingInterval as "daily" | "weekly" | "monthly" | "yearly",
      amount: body.amount,
      currency: body.currency,
      trialDays: body.trialDays,
      features: body.features,
      metadata: body.metadata,
    });
    if (!result.ok) {
      res.status(422).json({ type: "error", title: "Plan Error", status: 422, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.get("/admin/subscriptions/plans", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const result = await svc.listPlans();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Plan Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ plans: result.value });
  });

  router.get("/admin/subscriptions/plans/:id", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const result = await svc.getPlan(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Plan Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.delete("/admin/subscriptions/plans/:id", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const result = await svc.archivePlan(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Plan Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  // --- Subscriptions ---

  router.post("/admin/subscriptions", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const body = req.body as {
      customerId?: string; planId?: string;
      paymentMethodTokenId?: string; quantity?: number;
    };
    if (!body.customerId || !body.planId) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "customerId and planId are required" });
      return;
    }
    const result = await svc.create({
      customerId: body.customerId,
      planId: body.planId,
      paymentMethodTokenId: body.paymentMethodTokenId,
      quantity: body.quantity,
    });
    if (!result.ok) {
      const status = result.error.code === "INVALID_PLAN" ? 404 : 422;
      res.status(status).json({ type: "error", title: "Subscription Error", status, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.get("/admin/subscriptions", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const status = req.query["status"] as string | undefined;
    const result = await svc.list(status as import("../subscription/subscription-service.js").SubscriptionStatus | undefined);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Subscription Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ subscriptions: result.value });
  });

  router.get("/admin/subscriptions/:id", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const result = await svc.get(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Subscription Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/subscriptions/:id/cancel", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const body = req.body as { reason?: string; immediate?: boolean };
    const result = await svc.cancel(String(req.params["id"]), body.reason ?? "Canceled via admin", body.immediate);
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : result.error.code === "INVALID_STATUS" ? 409 : 500;
      res.status(status).json({ type: "error", title: "Subscription Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/subscriptions/:id/upgrade", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const body = req.body as { newPlanId?: string };
    if (!body.newPlanId) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "newPlanId is required" });
      return;
    }
    const result = await svc.upgrade(String(req.params["id"]), body.newPlanId);
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : result.error.code === "INVALID_STATUS" ? 409 : 422;
      res.status(status).json({ type: "error", title: "Subscription Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/subscriptions/:id/downgrade", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const body = req.body as { newPlanId?: string };
    if (!body.newPlanId) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "newPlanId is required" });
      return;
    }
    const result = await svc.downgrade(String(req.params["id"]), body.newPlanId);
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : result.error.code === "INVALID_STATUS" ? 409 : 422;
      res.status(status).json({ type: "error", title: "Subscription Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/subscriptions/:id/pause", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const result = await svc.pause(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : result.error.code === "INVALID_STATUS" ? 409 : 500;
      res.status(status).json({ type: "error", title: "Subscription Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/subscriptions/:id/resume", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const result = await svc.resume(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : result.error.code === "INVALID_STATUS" ? 409 : 500;
      res.status(status).json({ type: "error", title: "Subscription Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/subscriptions/:id/upcoming-invoice", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const result = await svc.getUpcomingInvoice(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Subscription Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/subscriptions/:id/events", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const result = await svc.getEvents(String(req.params["id"]));
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Subscription Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ events: result.value });
  });

  // --- Invoices ---

  router.get("/admin/invoices", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const billing = deps.paymentService.getBillingEngine(tenantId);
    const status = req.query["status"] as string | undefined;
    const subscriptionId = req.query["subscriptionId"] as string | undefined;
    const result = await billing.listInvoices({
      status: status as import("../billing/billing-engine.js").InvoiceStatus | undefined,
      subscriptionId,
    });
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Invoice Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ invoices: result.value });
  });

  router.get("/admin/invoices/:id", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const billing = deps.paymentService.getBillingEngine(tenantId);
    const result = await billing.getInvoice(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Invoice Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/invoices/:id/pay", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const billing = deps.paymentService.getBillingEngine(tenantId);
    const result = await billing.attemptPayment(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : result.error.code === "INVALID_STATUS" ? 409 : 422;
      res.status(status).json({ type: "error", title: "Invoice Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/invoices/:id/void", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const billing = deps.paymentService.getBillingEngine(tenantId);
    const result = await billing.voidInvoice(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : result.error.code === "INVALID_STATUS" ? 409 : 500;
      res.status(status).json({ type: "error", title: "Invoice Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/billing/process", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const billing = deps.paymentService.getBillingEngine(tenantId);
    const result = await billing.processDueSubscriptions();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Billing Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  // --- Dunning ---

  router.get("/admin/dunning/config", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const dunning = deps.paymentService.getDunningService(tenantId);
    const result = await dunning.getConfig();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Dunning Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.put("/admin/dunning/config", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const dunning = deps.paymentService.getDunningService(tenantId);
    const result = await dunning.updateConfig(req.body as Record<string, unknown>);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Dunning Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/dunning/active", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const dunning = deps.paymentService.getDunningService(tenantId);
    const result = await dunning.getActiveDunningFlows();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Dunning Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ flows: result.value });
  });

  router.post("/admin/dunning/process", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const dunning = deps.paymentService.getDunningService(tenantId);
    const result = await dunning.processRetries();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Dunning Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/dunning/analytics", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const dunning = deps.paymentService.getDunningService(tenantId);
    const result = await dunning.getRetryAnalytics();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Dunning Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  // --- Disputes ---

  router.post("/admin/disputes", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const disputeService = deps.paymentService.getDisputeService(tenantId);
    const { paymentId, reason, amount, type, merchantAccountId } = req.body as {
      paymentId?: string;
      reason?: string;
      amount?: number;
      type?: string;
      merchantAccountId?: string;
    };

    if (!paymentId || !reason || !amount) {
      res.status(400).json({ type: "error", title: "Validation Error", status: 400, detail: "paymentId, reason, and amount are required" });
      return;
    }

    const result = await disputeService.receiveDispute(
      paymentId,
      reason as Parameters<typeof disputeService.receiveDispute>[1],
      amount,
      type as Parameters<typeof disputeService.receiveDispute>[3],
      merchantAccountId,
    );
    if (!result.ok) {
      const status = result.error.code === "VALIDATION" ? 400 : 500;
      res.status(status).json({ type: "error", title: "Dispute Error", status, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.get("/admin/disputes", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const disputeService = deps.paymentService.getDisputeService(tenantId);
    const { status, paymentId, limit, offset } = req.query as {
      status?: string;
      paymentId?: string;
      limit?: string;
      offset?: string;
    };

    const result = await disputeService.listDisputes({
      status: status as Parameters<typeof disputeService.listDisputes>[0] extends infer F ? F extends { status?: infer S } ? S : undefined : undefined,
      paymentId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Dispute Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/disputes/chargeback-rate", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const disputeService = deps.paymentService.getDisputeService(tenantId);
    const { merchantAccountId } = req.query as { merchantAccountId?: string };

    const result = await disputeService.getChargebackRate(merchantAccountId);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Dispute Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/disputes/:id", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const disputeService = deps.paymentService.getDisputeService(tenantId);
    const result = await disputeService.getDispute(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Dispute Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/disputes/:id/evidence", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const disputeService = deps.paymentService.getDisputeService(tenantId);
    const { evidence } = req.body as { evidence?: Array<{ type: string; description: string; content: string }> };

    if (!evidence || !Array.isArray(evidence) || evidence.length === 0) {
      res.status(400).json({ type: "error", title: "Validation Error", status: 400, detail: "evidence array is required" });
      return;
    }

    const result = await disputeService.submitEvidence(String(req.params["id"]), evidence as Parameters<typeof disputeService.submitEvidence>[1]);
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        INVALID_STATUS: 409,
        EVIDENCE_DEADLINE_PASSED: 410,
        VALIDATION: 400,
      };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Dispute Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/disputes/:id/resolve", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const disputeService = deps.paymentService.getDisputeService(tenantId);
    const { outcome } = req.body as { outcome?: string };

    if (!outcome || (outcome !== "won" && outcome !== "lost")) {
      res.status(400).json({ type: "error", title: "Validation Error", status: 400, detail: "outcome must be 'won' or 'lost'" });
      return;
    }

    const result = await disputeService.resolveDispute(String(req.params["id"]), outcome);
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Dispute Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/disputes/:id/accept", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const disputeService = deps.paymentService.getDisputeService(tenantId);

    const result = await disputeService.acceptDispute(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Dispute Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  // ── Split Payments ──────────────────────────────────────────────────────────

  router.post("/admin/splits", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const splitService = deps.paymentService.getSplitPaymentService(tenantId);
    const { paymentId, paymentAmount, splits } = req.body as {
      paymentId?: string;
      paymentAmount?: number;
      splits?: Array<{ recipientType: string; recipientId: string; amount: number; currency?: string; splitType?: string; description?: string }>;
    };

    if (!paymentId || !paymentAmount || !splits) {
      res.status(400).json({ type: "error", title: "Validation Error", status: 400, detail: "paymentId, paymentAmount, and splits[] are required" });
      return;
    }

    const result = await splitService.configureSplits(paymentId, paymentAmount, splits as Parameters<typeof splitService.configureSplits>[2]);
    if (!result.ok) {
      const statusMap: Record<string, number> = { VALIDATION: 400, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Split Error", status, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.post("/admin/splits/:paymentId/execute", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const splitService = deps.paymentService.getSplitPaymentService(tenantId);

    const result = await splitService.executeSplits(String(req.params["paymentId"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Split Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/splits/:paymentId", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const splitService = deps.paymentService.getSplitPaymentService(tenantId);

    const result = await splitService.getSplits(String(req.params["paymentId"]));
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Split Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  // ── Payout Accounts ─────────────────────────────────────────────────────────

  router.post("/admin/payout-accounts", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const payoutService = deps.paymentService.getPayoutService(tenantId);
    const body = req.body as Partial<{
      merchantAccountId: string;
      type: string;
      bankName: string;
      accountNumberLast4: string;
      routingNumber: string;
      currency: string;
      country: string;
    }>;

    if (!body.merchantAccountId || !body.bankName || !body.accountNumberLast4) {
      res.status(400).json({ type: "error", title: "Validation Error", status: 400, detail: "merchantAccountId, bankName, and accountNumberLast4 are required" });
      return;
    }

    const result = await payoutService.createPayoutAccount({
      merchantAccountId: body.merchantAccountId,
      type: (body.type as "bank_account" | "wallet") ?? undefined,
      bankName: body.bankName,
      accountNumberLast4: body.accountNumberLast4,
      routingNumber: body.routingNumber ?? "",
      currency: body.currency,
      country: body.country,
    });
    if (!result.ok) {
      const statusMap: Record<string, number> = { VALIDATION: 400 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.get("/admin/payout-accounts", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const payoutService = deps.paymentService.getPayoutService(tenantId);
    const merchantAccountId = req.query["merchantAccountId"] as string | undefined;

    const result = await payoutService.listPayoutAccounts(merchantAccountId);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Payout Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/payout-accounts/:id", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const payoutService = deps.paymentService.getPayoutService(tenantId);

    const result = await payoutService.getPayoutAccount(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/payout-accounts/:id/verify", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const payoutService = deps.paymentService.getPayoutService(tenantId);

    const result = await payoutService.verifyPayoutAccount(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/payout-accounts/:id/disable", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const payoutService = deps.paymentService.getPayoutService(tenantId);

    const result = await payoutService.disablePayoutAccount(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/payout-accounts/:id/default", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const payoutService = deps.paymentService.getPayoutService(tenantId);

    const result = await payoutService.setDefaultPayoutAccount(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  // ── Payouts ─────────────────────────────────────────────────────────────────

  router.post("/admin/payouts", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const payoutService = deps.paymentService.getPayoutService(tenantId);
    const body = req.body as Partial<{
      merchantAccountId: string;
      payoutAccountId: string;
      amount: number;
      currency: string;
      settlementIds: string[];
    }>;

    if (!body.merchantAccountId || !body.amount) {
      res.status(400).json({ type: "error", title: "Validation Error", status: 400, detail: "merchantAccountId and amount are required" });
      return;
    }

    const result = await payoutService.schedulePayout({
      merchantAccountId: body.merchantAccountId,
      payoutAccountId: body.payoutAccountId,
      amount: body.amount,
      currency: body.currency,
      settlementIds: body.settlementIds,
    });
    if (!result.ok) {
      const statusMap: Record<string, number> = { VALIDATION: 400, NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.get("/admin/payouts", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const payoutService = deps.paymentService.getPayoutService(tenantId);

    const result = await payoutService.listPayouts({
      status: (req.query["status"] as string | undefined) as "pending" | "processing" | "in_transit" | "paid" | "failed" | "canceled" | undefined,
      merchantAccountId: req.query["merchantAccountId"] as string | undefined,
      limit: req.query["limit"] ? Number(req.query["limit"]) : undefined,
      offset: req.query["offset"] ? Number(req.query["offset"]) : undefined,
    });
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Payout Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/payouts/:id", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const payoutService = deps.paymentService.getPayoutService(tenantId);

    const result = await payoutService.getPayout(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/payouts/:id/process", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const payoutService = deps.paymentService.getPayoutService(tenantId);

    const result = await payoutService.processPayout(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/payouts/:id/cancel", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const payoutService = deps.paymentService.getPayoutService(tenantId);

    const result = await payoutService.cancelPayout(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  // --- Analytics ---

  router.get("/admin/analytics/metrics", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const analytics = deps.paymentService.getAnalyticsService(tenantId);
    const metricName = req.query["metricName"] as string | undefined;
    const providerId = req.query["providerId"] as string | undefined;
    const windowName = req.query["window"] as string | undefined;
    const from = req.query["from"] ? new Date(String(req.query["from"])) : undefined;
    const to = req.query["to"] ? new Date(String(req.query["to"])) : undefined;

    const result = await analytics.getMetrics({ metricName, providerId, windowName: windowName as "1h" | "24h" | "7d" | "30d" | "90d" | undefined, from, to });
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Analytics Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ metrics: result.value });
  });

  router.get("/admin/analytics/timeseries", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const analytics = deps.paymentService.getAnalyticsService(tenantId);
    const metricName = String(req.query["metricName"] ?? "authorization_rate");
    const from = new Date(String(req.query["from"] ?? new Date(Date.now() - 86_400_000).toISOString()));
    const to = new Date(String(req.query["to"] ?? new Date().toISOString()));
    const granularity = String(req.query["granularity"] ?? "1h");

    const result = await analytics.getTimeSeries(metricName, from, to, granularity);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Analytics Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ timeseries: result.value });
  });

  router.get("/admin/analytics/compare", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const analytics = deps.paymentService.getAnalyticsService(tenantId);
    const metricName = String(req.query["metricName"] ?? "authorization_rate");
    const windowName = String(req.query["window"] ?? "7d");

    // Build current and previous windows
    const { buildTimeWindow } = await import("../analytics/analytics-service.js");
    const now = new Date();
    const current = buildTimeWindow(windowName as "1h" | "24h" | "7d" | "30d" | "90d", now);
    const previous = buildTimeWindow(windowName as "1h" | "24h" | "7d" | "30d" | "90d", current.start);

    const result = await analytics.compareWindows(metricName, current, previous);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Analytics Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/analytics/compute", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const analytics = deps.paymentService.getAnalyticsService(tenantId);
    const windowName = String(req.body?.window ?? "24h");

    const { buildTimeWindow } = await import("../analytics/analytics-service.js");
    const window = buildTimeWindow(windowName as "1h" | "24h" | "7d" | "30d" | "90d");

    const result = await analytics.computeMetrics(window);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Analytics Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ metrics: result.value, count: result.value.length });
  });

  // --- Reports ---

  router.post("/admin/reports", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const reportService = deps.paymentService.getReportService(tenantId);
    const body = req.body as {
      type?: string;
      dateRangeStart?: string;
      dateRangeEnd?: string;
      status?: string;
      providerId?: string;
      customerId?: string;
      format?: string;
    };

    if (!body.type || !body.dateRangeStart || !body.dateRangeEnd) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "type, dateRangeStart, and dateRangeEnd are required" });
      return;
    }

    const dateRange = { start: new Date(body.dateRangeStart), end: new Date(body.dateRangeEnd) };
    let result;

    switch (body.type) {
      case "transaction":
        result = await reportService.generateTransactionReport({
          dateRange,
          status: body.status,
          providerId: body.providerId,
          customerId: body.customerId,
          format: body.format as "csv" | "json" | undefined,
        });
        break;
      case "settlement":
        result = await reportService.generateSettlementReport(dateRange);
        break;
      case "dispute":
        result = await reportService.generateDisputeReport(dateRange);
        break;
      case "revenue":
        result = await reportService.generateRevenueReport(dateRange);
        break;
      default:
        res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: `Invalid report type: ${body.type}` });
        return;
    }

    if (!result.ok) {
      res.status(422).json({ type: "error", title: "Report Error", status: 422, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.get("/admin/reports", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const reportService = deps.paymentService.getReportService(tenantId);
    const result = await reportService.listReports();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Report Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ reports: result.value });
  });

  router.get("/admin/reports/:id", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const reportService = deps.paymentService.getReportService(tenantId);
    const result = await reportService.getReport(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Report Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/reports/:id/download", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const reportService = deps.paymentService.getReportService(tenantId);
    const result = await reportService.getReportData(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Report Error", status, detail: result.error.message });
      return;
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=report-${String(req.params["id"])}.csv`);
    res.send(result.value);
  });

  // --- Experiments ---

  router.post("/admin/experiments", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const experimentService = deps.paymentService.getExperimentService(tenantId);
    const body = req.body as {
      name?: string;
      description?: string;
      controlProviderId?: string;
      controlWeight?: number;
      variants?: { name: string; providerId: string; weight: number }[];
      trafficAllocation?: number;
      targetMetrics?: string[];
      minimumSampleSize?: number;
      confidenceLevel?: number;
    };

    if (!body.name || !body.controlProviderId || !body.variants) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "name, controlProviderId, and variants are required" });
      return;
    }

    const result = await experimentService.createExperiment({
      name: body.name,
      description: body.description,
      controlProviderId: body.controlProviderId,
      controlWeight: body.controlWeight,
      variants: body.variants,
      trafficAllocation: body.trafficAllocation,
      targetMetrics: body.targetMetrics,
      minimumSampleSize: body.minimumSampleSize,
      confidenceLevel: body.confidenceLevel,
    });
    if (!result.ok) {
      const statusMap: Record<string, number> = { VALIDATION: 400 };
      const status = statusMap[result.error.code] ?? 422;
      res.status(status).json({ type: "error", title: "Experiment Error", status, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.get("/admin/experiments", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const experimentService = deps.paymentService.getExperimentService(tenantId);
    const result = await experimentService.listExperiments();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Experiment Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ experiments: result.value });
  });

  router.get("/admin/experiments/:id", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const experimentService = deps.paymentService.getExperimentService(tenantId);
    const result = await experimentService.getExperiment(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Experiment Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/experiments/:id/start", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const experimentService = deps.paymentService.getExperimentService(tenantId);
    const result = await experimentService.startExperiment(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Experiment Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/experiments/:id/pause", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const experimentService = deps.paymentService.getExperimentService(tenantId);
    const result = await experimentService.pauseExperiment(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Experiment Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/experiments/:id/complete", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const experimentService = deps.paymentService.getExperimentService(tenantId);
    const result = await experimentService.completeExperiment(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Experiment Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/experiments/:id/results", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const experimentService = deps.paymentService.getExperimentService(tenantId);
    const result = await experimentService.getResults(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Experiment Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/experiments/:id/declare-winner", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const experimentService = deps.paymentService.getExperimentService(tenantId);
    const body = req.body as { variantName?: string };

    if (!body.variantName) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "variantName is required" });
      return;
    }

    const result = await experimentService.declareWinner(String(req.params["id"]), body.variantName);
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, VALIDATION: 400, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Experiment Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  // --- 3D Secure ---

  router.post("/admin/3ds/initiate", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const threeDSecure = deps.paymentService.getThreeDSecureService(tenantId);
    const body = req.body as {
      paymentId?: string;
      amount?: number;
      currency?: string;
      region?: string;
      fraudScore?: number;
      isTrustedBeneficiary?: boolean;
      version?: string;
    };

    if (!body.paymentId || !body.amount) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "paymentId and amount are required" });
      return;
    }

    const result = await threeDSecure.initiate(body.paymentId, {
      amount: body.amount,
      currency: body.currency ?? "USD",
      region: body.region,
      fraudScore: body.fraudScore,
      isTrustedBeneficiary: body.isTrustedBeneficiary,
      version: body.version as "3ds1" | "3ds2" | undefined,
    });

    if (!result.ok) {
      res.status(500).json({ type: "error", title: "3DS Error", status: 500, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.post("/admin/3ds/:id/complete", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const threeDSecure = deps.paymentService.getThreeDSecureService(tenantId);
    const body = req.body as { outcome?: string };
    const outcome = body.outcome === "failed" ? "failed" : "authenticated";

    const result = await threeDSecure.complete(String(req.params["id"]), outcome);
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, ALREADY_COMPLETED: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "3DS Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/3ds/payment/:paymentId", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const threeDSecure = deps.paymentService.getThreeDSecureService(tenantId);
    const result = await threeDSecure.check(String(req.params["paymentId"]));
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "3DS Error", status: 500, detail: result.error.message });
      return;
    }
    if (!result.value) {
      res.status(404).json({ type: "not_found", title: "Not Found", status: 404, detail: "No 3DS record for this payment" });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/3ds/check", (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const threeDSecure = deps.paymentService.getThreeDSecureService(tenantId);
    const body = req.body as {
      amount?: number;
      currency?: string;
      region?: string;
      fraudScore?: number;
      isTrustedBeneficiary?: boolean;
    };

    if (!body.amount) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "amount is required" });
      return;
    }

    const required = threeDSecure.shouldRequire({
      amount: body.amount,
      currency: body.currency ?? "USD",
      region: body.region,
      fraudScore: body.fraudScore,
      isTrustedBeneficiary: body.isTrustedBeneficiary,
    });

    res.json({ required });
  });

  // --- Payment Methods ---

  router.post("/admin/payment-methods", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const pmService = deps.paymentService.getPaymentMethodService(tenantId);
    const body = req.body as Record<string, unknown>;

    const result = await pmService.create(body as never);
    if (!result.ok) {
      const statusMap: Record<string, number> = { VALIDATION: 400, NOT_ELIGIBLE: 422 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Payment Method Error", status, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.get("/admin/payment-methods", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const pmService = deps.paymentService.getPaymentMethodService(tenantId);
    const customerId = String(req.query["customerId"] ?? "");

    if (!customerId) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "customerId query param is required" });
      return;
    }

    const result = await pmService.listByCustomer(customerId);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Payment Method Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ methods: result.value });
  });

  router.get("/admin/payment-methods/supported", (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const pmService = deps.paymentService.getPaymentMethodService(tenantId);
    const currency = String(req.query["currency"] ?? "USD");
    const country = req.query["country"] ? String(req.query["country"]) : undefined;
    const methods = pmService.getSupportedMethods(currency, country);
    res.json({ methods });
  });

  router.get("/admin/payment-methods/:id", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const pmService = deps.paymentService.getPaymentMethodService(tenantId);
    const result = await pmService.get(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Payment Method Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/payment-methods/:id/default", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const pmService = deps.paymentService.getPaymentMethodService(tenantId);
    const body = req.body as { customerId?: string };

    if (!body.customerId) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "customerId is required" });
      return;
    }

    const result = await pmService.setDefault(body.customerId, String(req.params["id"]));
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Payment Method Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/payment-methods/:id/revoke", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const pmService = deps.paymentService.getPaymentMethodService(tenantId);
    const result = await pmService.revoke(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Payment Method Error", status, detail: result.error.message });
      return;
    }
    res.json({ success: true });
  });

  // --- Checkout Sessions ---

  router.post("/checkout/sessions", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const checkout = deps.paymentService.getCheckoutService(tenantId);
    const body = req.body as Record<string, unknown>;

    const result = await checkout.createSession(body as never);
    if (!result.ok) {
      const statusMap: Record<string, number> = { VALIDATION: 400 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Checkout Error", status, detail: result.error.message });
      return;
    }
    res.status(201).json({
      ...result.value,
      checkoutUrl: `/checkout/${result.value.id}`,
    });
  });

  router.get("/checkout/sessions", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const checkout = deps.paymentService.getCheckoutService(tenantId);
    const status = req.query["status"] ? String(req.query["status"]) : undefined;
    const limit = req.query["limit"] ? parseInt(String(req.query["limit"]), 10) : undefined;

    const result = await checkout.listSessions({ status, limit });
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Checkout Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ sessions: result.value });
  });

  router.get("/checkout/sessions/:id", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const checkout = deps.paymentService.getCheckoutService(tenantId);
    const result = await checkout.getSession(String(req.params["id"]));
    if (!result.ok) {
      const statusCode = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(statusCode).json({ type: "error", title: "Checkout Error", status: statusCode, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/checkout/sessions/:id/complete", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const checkout = deps.paymentService.getCheckoutService(tenantId);
    const body = req.body as { paymentId?: string; paymentMethodType?: string };

    if (!body.paymentId || !body.paymentMethodType) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "paymentId and paymentMethodType are required" });
      return;
    }

    const result = await checkout.completeSession(String(req.params["id"]), body.paymentId, body.paymentMethodType);
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, EXPIRED: 410, ALREADY_COMPLETE: 409 };
      const statusCode = statusMap[result.error.code] ?? 500;
      res.status(statusCode).json({ type: "error", title: "Checkout Error", status: statusCode, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/checkout/sessions/:id/expire", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const checkout = deps.paymentService.getCheckoutService(tenantId);
    const result = await checkout.expireSession(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, ALREADY_COMPLETE: 409 };
      const statusCode = statusMap[result.error.code] ?? 500;
      res.status(statusCode).json({ type: "error", title: "Checkout Error", status: statusCode, detail: result.error.message });
      return;
    }
    res.json({ success: true });
  });

  router.get("/checkout/analytics", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const checkout = deps.paymentService.getCheckoutService(tenantId);
    const result = await checkout.getConversionStats();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Checkout Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  // --- Sandbox ---

  router.get("/admin/sandbox/test-cards", (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const sandbox = deps.paymentService.getSandboxService(tenantId);
    res.json({ cards: sandbox.getTestCards() });
  });

  router.post("/admin/sandbox/trigger-dispute", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const { paymentId } = req.body as { paymentId?: string };
    if (!paymentId) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "paymentId is required" });
      return;
    }
    const sandbox = deps.paymentService.getSandboxService(tenantId);
    const result = await sandbox.triggerDispute(paymentId);
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Sandbox Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/sandbox/reset", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
    const sandbox = deps.paymentService.getSandboxService(tenantId);
    const result = await sandbox.resetSandboxData();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Sandbox Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  // --- Webhook Catalog ---

  router.get("/admin/webhook-catalog", (req: Request, res: Response) => {
    const catalog = deps.paymentService.getWebhookCatalog();
    const category = String(req.query["category"] ?? "");
    const events = category ? catalog.getEventsByCategory(category) : catalog.getEvents();
    res.json({ events, categories: catalog.getCategories() });
  });

  router.get("/admin/webhook-catalog/:type", (req: Request, res: Response) => {
    const catalog = deps.paymentService.getWebhookCatalog();
    const eventType = String(req.params["type"]);
    const event = catalog.getEvent(eventType);
    if (!event) {
      res.status(404).json({ type: "not_found", title: "Not Found", status: 404, detail: `Event type "${eventType}" not found` });
      return;
    }
    res.json(event);
  });

  // --- Queue Management ---

  router.get("/admin/queues", async (_req: Request, res: Response) => {
    if (!deps.queueService) {
      res.json({ queues: [], message: "Queue service not configured" });
      return;
    }
    try {
      const stats = await deps.queueService.getQueueStats();
      res.json({ queues: stats });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to get queue stats" });
    }
  });

  router.get("/admin/queues/:name", async (req: Request, res: Response) => {
    if (!deps.queueService) {
      res.status(503).json({ error: "Queue service not configured" });
      return;
    }
    const name = String(req.params["name"]) as QueueName;
    if (!ALL_QUEUE_NAMES.includes(name)) {
      res.status(404).json({ error: `Unknown queue: ${name}` });
      return;
    }
    try {
      const counts = await deps.queueService.getJobCounts(name);
      res.json({ name, ...counts });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to get queue stats" });
    }
  });

  router.get("/admin/queues/:name/failed", async (req: Request, res: Response) => {
    if (!deps.queueService) {
      res.status(503).json({ error: "Queue service not configured" });
      return;
    }
    const name = String(req.params["name"]) as QueueName;
    if (!ALL_QUEUE_NAMES.includes(name)) {
      res.status(404).json({ error: `Unknown queue: ${name}` });
      return;
    }
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "20"), 10), 100);
    try {
      const failed = await deps.queueService.getFailedJobs(name, limit);
      res.json({ jobs: failed });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to get failed jobs" });
    }
  });

  router.post("/admin/queues/:name/retry/:jobId", async (req: Request, res: Response) => {
    if (!deps.queueService) {
      res.status(503).json({ error: "Queue service not configured" });
      return;
    }
    const name = String(req.params["name"]) as QueueName;
    const jobId = String(req.params["jobId"]);
    try {
      await deps.queueService.retryJob(name, jobId);
      res.json({ success: true, queue: name, jobId });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to retry job" });
    }
  });

  router.post("/admin/queues/:name/drain", async (req: Request, res: Response) => {
    if (!deps.queueService) {
      res.status(503).json({ error: "Queue service not configured" });
      return;
    }
    const name = String(req.params["name"]) as QueueName;
    try {
      await deps.queueService.drainQueue(name);
      res.json({ success: true, queue: name });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to drain queue" });
    }
  });

  router.post("/admin/queues/:name/pause", async (req: Request, res: Response) => {
    if (!deps.queueService) {
      res.status(503).json({ error: "Queue service not configured" });
      return;
    }
    const name = String(req.params["name"]) as QueueName;
    try {
      await deps.queueService.pauseQueue(name);
      res.json({ success: true, queue: name, paused: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to pause queue" });
    }
  });

  router.post("/admin/queues/:name/resume", async (req: Request, res: Response) => {
    if (!deps.queueService) {
      res.status(503).json({ error: "Queue service not configured" });
      return;
    }
    const name = String(req.params["name"]) as QueueName;
    try {
      await deps.queueService.resumeQueue(name);
      res.json({ success: true, queue: name, paused: false });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to resume queue" });
    }
  });

  return router;
}

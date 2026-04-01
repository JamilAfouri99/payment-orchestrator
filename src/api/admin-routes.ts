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

  return router;
}

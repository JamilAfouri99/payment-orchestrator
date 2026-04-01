import { Router, type Request, type Response } from "express";
import type { ChaosController } from "../chaos/chaos-controller.js";
import type { CircuitBreakerRegistry } from "../circuit-breaker/circuit-breaker-registry.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";
import type { Logger } from "../core/logger.js";
import type { Bulkhead } from "../bulkhead/bulkhead.js";
import type { PrismaClient } from "@prisma/client";
import { getRecentLogs } from "../core/logger.js";
import { recoverIncompleteSagas } from "../saga/saga-recovery.js";
import { signPayload, verifySignature } from "../webhooks/webhook-delivery.js";

export interface AdminRouteDeps {
  chaos: ChaosController;
  cbRegistry: CircuitBreakerRegistry;
  metrics: MetricsCollector;
  logger: Logger;
  bulkheads: Bulkhead[];
  prisma: PrismaClient;
  webhookSecret: string;
}

/**
 * Creates admin routes for chaos engineering, monitoring, and management.
 * @param deps - Admin dependencies
 * @returns Express Router with admin endpoints
 */
export function createAdminRoutes(deps: AdminRouteDeps): Router {
  const router = Router();

  // --- Chaos Engineering ---

  router.get("/admin/chaos", (_req: Request, res: Response) => {
    res.json({ services: deps.chaos.getAll() });
  });

  router.post("/admin/chaos", (req: Request, res: Response) => {
    const { service, failureRate, latencyMs, enabled } = req.body as {
      service?: string;
      failureRate?: number;
      latencyMs?: number;
      enabled?: boolean;
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

  router.post("/admin/saga-recovery", async (_req: Request, res: Response) => {
    const result = await recoverIncompleteSagas(deps.prisma, deps.logger);
    res.json(result);
  });

  // --- Webhook Signature Verification Playground ---

  router.post("/webhooks/verify", (req: Request, res: Response) => {
    const { payload, signature, secret } = req.body as {
      payload?: string;
      signature?: string;
      secret?: string;
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

  return router;
}

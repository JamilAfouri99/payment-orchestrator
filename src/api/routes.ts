import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import type { PaymentService } from "./payment-service.js";
import type { PaymentRequest } from "../core/types.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";
import { createIdempotencyMiddleware } from "../idempotency/idempotency-middleware.js";
import type { HealthService } from "../health/health-service.js";
import { respondProblem, respondFromError, getTenantId } from "./route-helpers.js";

export interface RouteDeps {
  paymentService: PaymentService;
  prisma: PrismaClient;
  idempotencyTtlMs: number;
  metrics: MetricsCollector;
  healthService?: HealthService | undefined;
  prometheusFormatter?: { format(): Promise<string> } | undefined;
}

/**
 * Creates Express router with all public API endpoints.
 * @param deps - Route dependencies
 * @returns Configured Express Router
 */
export function createRoutes(deps: RouteDeps): Router {
  const { paymentService, prisma, idempotencyTtlMs, metrics, healthService, prometheusFormatter } = deps;
  const router = Router();
  const idempotencyMiddleware = createIdempotencyMiddleware(prisma, idempotencyTtlMs);

  // --- Health ---

  router.get("/health", (_req: Request, res: Response) => {
    if (healthService) {
      res.json(healthService.liveness());
    } else {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    }
  });

  router.get("/health/ready", async (_req: Request, res: Response) => {
    if (!healthService) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: "healthy", timestamp: new Date().toISOString() });
      } catch {
        respondProblem(res, 503, "Service Unhealthy", "Database connectivity check failed");
      }
      return;
    }

    const result = await healthService.readiness();
    const statusCode = result.status === "unhealthy" ? 503 : 200;
    res.status(statusCode).json(result);
  });

  router.get("/health/metrics", async (_req: Request, res: Response) => {
    if (!prometheusFormatter) {
      res.status(503).send("# Prometheus metrics not configured\n");
      return;
    }
    const output = await prometheusFormatter.format();
    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(output);
  });

  // --- Payments ---

  router.get("/payments", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "20"), 10), 100);
    const offset = parseInt(String(req.query["offset"] ?? "0"), 10);

    const result = await paymentService.listPayments(tenantId, limit, offset);
    if (!result.ok) {
      respondFromError(res, result.error);
      return;
    }
    res.json(result.value);
  });

  router.post("/payments", idempotencyMiddleware, async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const body = req.body as Partial<PaymentRequest>;

    if (!body.amount || !body.currency || !body.customerId || !body.orderId || !body.items) {
      respondProblem(res, 400, "Invalid Payment Request", "Missing required fields: amount, currency, customerId, orderId, items");
      return;
    }

    const result = await paymentService.initiatePayment(tenantId, {
      amount: body.amount,
      currency: body.currency,
      customerId: body.customerId,
      orderId: body.orderId,
      items: body.items,
      region: (body as Record<string, unknown>)["region"] as string | undefined,
      card: (body as Record<string, unknown>)["card"] as import("../core/types.js").CardDetails | undefined,
      token: (body as Record<string, unknown>)["token"] as string | undefined,
    });

    if (!result.ok) {
      respondFromError(res, result.error);
      return;
    }

    metrics.increment("payments_via_api");
    res.status(201).json(result.value);
  });

  router.get("/payments/:id", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const result = await paymentService.getPayment(tenantId, String(req.params["id"]));
    if (!result.ok) { respondFromError(res, result.error); return; }
    res.json(result.value);
  });

  router.get("/payments/:id/events", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const result = await paymentService.getPaymentEvents(tenantId, String(req.params["id"]));
    if (!result.ok) { respondFromError(res, result.error); return; }
    res.json(result.value);
  });

  router.get("/payments/:id/state", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const at = req.query["at"];
    if (!at || typeof at !== "string") {
      respondProblem(res, 400, "Bad Request", "Query parameter 'at' (ISO date) is required");
      return;
    }
    const date = new Date(at);
    if (isNaN(date.getTime())) {
      respondProblem(res, 400, "Bad Request", "Invalid date format for 'at' parameter");
      return;
    }
    const result = await paymentService.getPaymentAt(tenantId, String(req.params["id"]), date);
    if (!result.ok) { respondFromError(res, result.error); return; }
    res.json(result.value);
  });

  router.post("/payments/:id/replay", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const result = await paymentService.replayPayment(tenantId, String(req.params["id"]));
    if (!result.ok) { respondFromError(res, result.error); return; }
    res.json(result.value);
  });

  // --- Webhooks ---

  router.post("/webhooks/register", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { url, events } = req.body as { url?: string; events?: string[] };
    if (!url) {
      respondProblem(res, 400, "Invalid Webhook Registration", "URL is required");
      return;
    }

    const webhookService = paymentService.getWebhookService(tenantId);
    const result = await webhookService.register(url, events);
    if (!result.ok) {
      respondProblem(res, 500, "Webhook Registration Failed", result.error.message);
      return;
    }
    res.status(201).json({ id: result.value, url, events: events ?? ["*"] });
  });

  router.get("/webhooks/registrations", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    try {
      const registrations = await prisma.webhookRegistration.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      });
      res.json(registrations);
    } catch (e) {
      console.error("webhook_registrations_fetch_failed", e);
      respondProblem(res, 500, "Internal Error", "Failed to fetch registrations");
    }
  });

  router.get("/webhooks/deliveries", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    try {
      const deliveries = await prisma.webhookDelivery.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      res.json(deliveries);
    } catch (e) {
      console.error("webhook_deliveries_fetch_failed", e);
      respondProblem(res, 500, "Internal Error", "Failed to fetch deliveries");
    }
  });

  router.get("/webhooks/dlq", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    try {
      const entries = await prisma.deadLetterQueue.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      res.json(entries);
    } catch (e) {
      console.error("webhook_dlq_fetch_failed", e);
      respondProblem(res, 500, "Internal Error", "Failed to fetch DLQ entries");
    }
  });

  router.post("/webhooks/dlq/:id/retry", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    try {
      const entry = await prisma.deadLetterQueue.findUnique({
        where: { id: String(req.params["id"]) },
      });
      if (!entry || entry.tenantId !== tenantId) {
        respondProblem(res, 404, "Not Found", "DLQ entry not found");
        return;
      }

      const webhookService = paymentService.getWebhookService(tenantId);
      const payload = entry.payload as { eventType?: string; payload?: Record<string, unknown> };
      await webhookService.dispatch(
        payload.eventType ?? "dlq.retry",
        (payload.payload as Record<string, unknown>) ?? {},
      );

      await prisma.deadLetterQueue.delete({ where: { id: entry.id } });
      metrics.increment("dlq_retries");
      res.json({ success: true });
    } catch (e) {
      console.error("webhook_dlq_retry_failed", e);
      respondProblem(res, 500, "Internal Error", "Failed to retry DLQ entry");
    }
  });

  return router;
}


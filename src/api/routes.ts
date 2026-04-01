import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import type { PaymentService } from "./payment-service.js";
import type { ProblemDetails, PaymentRequest } from "../core/types.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";
import { createIdempotencyMiddleware } from "../idempotency/idempotency-middleware.js";

export interface RouteDeps {
  paymentService: PaymentService;
  prisma: PrismaClient;
  idempotencyTtlMs: number;
  metrics: MetricsCollector;
}

/**
 * Creates Express router with all public API endpoints.
 * @param deps - Route dependencies
 * @returns Configured Express Router
 */
export function createRoutes(deps: RouteDeps): Router {
  const { paymentService, prisma, idempotencyTtlMs, metrics } = deps;
  const router = Router();
  const idempotencyMiddleware = createIdempotencyMiddleware(prisma, idempotencyTtlMs);

  // --- Health ---

  router.get("/health", async (_req: Request, res: Response) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "healthy", timestamp: new Date().toISOString() });
    } catch {
      respondProblem(res, 503, "Service Unhealthy", "Database connectivity check failed");
    }
  });

  // --- Payments ---

  router.get("/payments", async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "20"), 10), 100);
    const offset = parseInt(String(req.query["offset"] ?? "0"), 10);

    const result = await paymentService.listPayments(limit, offset);
    if (!result.ok) {
      respondFromError(res, result.error);
      return;
    }
    res.json(result.value);
  });

  router.post("/payments", idempotencyMiddleware, async (req: Request, res: Response) => {
    const body = req.body as Partial<PaymentRequest>;

    if (!body.amount || !body.currency || !body.customerId || !body.orderId || !body.items) {
      respondProblem(res, 400, "Invalid Payment Request", "Missing required fields: amount, currency, customerId, orderId, items");
      return;
    }

    const result = await paymentService.initiatePayment({
      amount: body.amount,
      currency: body.currency,
      customerId: body.customerId,
      orderId: body.orderId,
      items: body.items,
    });

    if (!result.ok) {
      respondFromError(res, result.error);
      return;
    }

    metrics.increment("payments_via_api");
    res.status(201).json(result.value);
  });

  router.get("/payments/:id", async (req: Request, res: Response) => {
    const result = await paymentService.getPayment(String(req.params["id"]));
    if (!result.ok) { respondFromError(res, result.error); return; }
    res.json(result.value);
  });

  router.get("/payments/:id/events", async (req: Request, res: Response) => {
    const result = await paymentService.getPaymentEvents(String(req.params["id"]));
    if (!result.ok) { respondFromError(res, result.error); return; }
    res.json(result.value);
  });

  router.get("/payments/:id/state", async (req: Request, res: Response) => {
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
    const result = await paymentService.getPaymentAt(String(req.params["id"]), date);
    if (!result.ok) { respondFromError(res, result.error); return; }
    res.json(result.value);
  });

  router.post("/payments/:id/replay", async (req: Request, res: Response) => {
    const result = await paymentService.replayPayment(String(req.params["id"]));
    if (!result.ok) { respondFromError(res, result.error); return; }
    res.json(result.value);
  });

  // --- Webhooks ---

  router.post("/webhooks/register", async (req: Request, res: Response) => {
    const { url, events } = req.body as { url?: string; events?: string[] };
    if (!url) {
      respondProblem(res, 400, "Invalid Webhook Registration", "URL is required");
      return;
    }

    const webhookService = paymentService.getWebhookService();
    const result = await webhookService.register(url, events);
    if (!result.ok) {
      respondProblem(res, 500, "Webhook Registration Failed", result.error.message);
      return;
    }
    res.status(201).json({ id: result.value, url, events: events ?? ["*"] });
  });

  router.get("/webhooks/registrations", async (_req: Request, res: Response) => {
    try {
      const registrations = await prisma.webhookRegistration.findMany({
        orderBy: { createdAt: "desc" },
      });
      res.json(registrations);
    } catch {
      respondProblem(res, 500, "Internal Error", "Failed to fetch registrations");
    }
  });

  router.get("/webhooks/deliveries", async (_req: Request, res: Response) => {
    try {
      const deliveries = await prisma.webhookDelivery.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      res.json(deliveries);
    } catch {
      respondProblem(res, 500, "Internal Error", "Failed to fetch deliveries");
    }
  });

  router.get("/webhooks/dlq", async (_req: Request, res: Response) => {
    try {
      const entries = await prisma.deadLetterQueue.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      res.json(entries);
    } catch {
      respondProblem(res, 500, "Internal Error", "Failed to fetch DLQ entries");
    }
  });

  router.post("/webhooks/dlq/:id/retry", async (req: Request, res: Response) => {
    try {
      const entry = await prisma.deadLetterQueue.findUnique({
        where: { id: String(req.params["id"]) },
      });
      if (!entry) {
        respondProblem(res, 404, "Not Found", "DLQ entry not found");
        return;
      }

      const webhookService = paymentService.getWebhookService();
      const payload = entry.payload as { eventType?: string; payload?: Record<string, unknown> };
      await webhookService.dispatch(
        payload.eventType ?? "dlq.retry",
        (payload.payload as Record<string, unknown>) ?? {},
      );

      await prisma.deadLetterQueue.delete({ where: { id: entry.id } });
      metrics.increment("dlq_retries");
      res.json({ success: true });
    } catch {
      respondProblem(res, 500, "Internal Error", "Failed to retry DLQ entry");
    }
  });

  return router;
}

function respondProblem(res: Response, status: number, title: string, detail: string): void {
  const problem: ProblemDetails = {
    type: `https://payment-orchestrator.dev/problems/${title.toLowerCase().replace(/\s+/g, "-")}`,
    title,
    status,
    detail,
  };
  res.status(status).json(problem);
}

function respondFromError(
  res: Response,
  error: { code: string; message: string },
): void {
  const statusMap: Record<string, number> = {
    VALIDATION: 400,
    NOT_FOUND: 404,
    SAGA_FAILED: 422,
    INTERNAL: 500,
  };
  const status = statusMap[error.code] ?? 500;
  respondProblem(res, status, error.code, error.message);
}

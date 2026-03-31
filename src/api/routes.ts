import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import type { PaymentService } from "./payment-service.js";
import type { ProblemDetails, PaymentRequest } from "../core/types.js";
import { createIdempotencyMiddleware } from "../idempotency/idempotency-middleware.js";

/**
 * Creates Express router with all API endpoints.
 * @param paymentService - The payment service instance
 * @param prisma - PrismaClient for health checks and idempotency
 * @param idempotencyTtlMs - TTL for idempotency keys
 * @returns Configured Express Router
 */
export function createRoutes(
  paymentService: PaymentService,
  prisma: PrismaClient,
  idempotencyTtlMs: number,
): Router {
  const router = Router();
  const idempotencyMiddleware = createIdempotencyMiddleware(prisma, idempotencyTtlMs);

  router.get("/health", async (_req: Request, res: Response) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "healthy", timestamp: new Date().toISOString() });
    } catch {
      const problem: ProblemDetails = {
        type: "https://payment-orchestrator.dev/problems/unhealthy",
        title: "Service Unhealthy",
        status: 503,
        detail: "Database connectivity check failed",
      };
      res.status(503).json(problem);
    }
  });

  router.post("/payments", idempotencyMiddleware, async (req: Request, res: Response) => {
    const body = req.body as Partial<PaymentRequest>;

    if (!body.amount || !body.currency || !body.customerId || !body.orderId || !body.items) {
      const problem: ProblemDetails = {
        type: "https://payment-orchestrator.dev/problems/invalid-request",
        title: "Invalid Payment Request",
        status: 400,
        detail: "Missing required fields: amount, currency, customerId, orderId, items",
      };
      res.status(400).json(problem);
      return;
    }

    const request: PaymentRequest = {
      amount: body.amount,
      currency: body.currency,
      customerId: body.customerId,
      orderId: body.orderId,
      items: body.items,
    };

    const result = await paymentService.initiatePayment(request);

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        VALIDATION: 400,
        NOT_FOUND: 404,
        SAGA_FAILED: 422,
        INTERNAL: 500,
      };

      const status = statusMap[result.error.code] ?? 500;
      const problem: ProblemDetails = {
        type: `https://payment-orchestrator.dev/problems/${result.error.code.toLowerCase()}`,
        title: result.error.code,
        status,
        detail: result.error.message,
      };
      res.status(status).json(problem);
      return;
    }

    res.status(201).json(result.value);
  });

  router.get("/payments/:id", async (req: Request, res: Response) => {
    const result = await paymentService.getPayment(String(req.params["id"]));

    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      const problem: ProblemDetails = {
        type: `https://payment-orchestrator.dev/problems/${result.error.code.toLowerCase()}`,
        title: result.error.code,
        status,
        detail: result.error.message,
      };
      res.status(status).json(problem);
      return;
    }

    res.json(result.value);
  });

  router.get("/payments/:id/events", async (req: Request, res: Response) => {
    const result = await paymentService.getPaymentEvents(String(req.params["id"]));

    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      const problem: ProblemDetails = {
        type: `https://payment-orchestrator.dev/problems/${result.error.code.toLowerCase()}`,
        title: result.error.code,
        status,
        detail: result.error.message,
      };
      res.status(status).json(problem);
      return;
    }

    res.json(result.value);
  });

  router.post("/webhooks/register", async (req: Request, res: Response) => {
    const { url, events } = req.body as { url?: string; events?: string[] };

    if (!url) {
      const problem: ProblemDetails = {
        type: "https://payment-orchestrator.dev/problems/invalid-request",
        title: "Invalid Webhook Registration",
        status: 400,
        detail: "URL is required",
      };
      res.status(400).json(problem);
      return;
    }

    const webhookService = paymentService.getWebhookService();
    const result = await webhookService.register(url, events);

    if (!result.ok) {
      const problem: ProblemDetails = {
        type: "https://payment-orchestrator.dev/problems/webhook-registration-failed",
        title: "Webhook Registration Failed",
        status: 500,
        detail: result.error.message,
      };
      res.status(500).json(problem);
      return;
    }

    res.status(201).json({ id: result.value, url, events: events ?? ["*"] });
  });

  return router;
}

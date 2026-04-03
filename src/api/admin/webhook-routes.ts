import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";
import { signPayload, verifySignature } from "../../webhooks/webhook-delivery.js";
import { getAllDeclineCodes } from "../../retry/decline-codes.js";
import { recoverIncompleteSagas } from "../../saga/saga-recovery.js";

export function registerWebhookAdminRoutes(router: Router, deps: AdminRouteDeps): void {
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

  router.post("/admin/saga-recovery", async (req: Request, res: Response) => {
    const tenantId = req.tenantContext?.tenantId;
    const result = await recoverIncompleteSagas(deps.prisma, deps.logger, tenantId);
    res.json(result);
  });

  router.get("/admin/decline-codes", (_req: Request, res: Response) => {
    res.json({ codes: getAllDeclineCodes() });
  });

  router.get("/payments/:id/retries", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
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
}

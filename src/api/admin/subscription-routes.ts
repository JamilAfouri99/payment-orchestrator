import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";
import type { SubscriptionStatus } from "../../subscription/subscription-service.js";

export function registerSubscriptionRoutes(router: Router, deps: AdminRouteDeps): void {
  router.post("/admin/subscriptions", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
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
    const tenantId = getTenantId(req);
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const status = req.query["status"] as SubscriptionStatus | undefined;
    const result = await svc.list(status);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Subscription Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ subscriptions: result.value });
  });

  router.get("/admin/subscriptions/:id", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
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
    const tenantId = getTenantId(req);
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
    const tenantId = getTenantId(req);
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
    const tenantId = getTenantId(req);
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
    const tenantId = getTenantId(req);
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
    const tenantId = getTenantId(req);
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
    const tenantId = getTenantId(req);
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
    const tenantId = getTenantId(req);
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const result = await svc.getEvents(String(req.params["id"]));
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Subscription Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ events: result.value });
  });
}

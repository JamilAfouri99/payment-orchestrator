import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";

export function registerPlanRoutes(router: Router, deps: AdminRouteDeps): void {
  router.post("/admin/subscriptions/plans", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
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
    const tenantId = getTenantId(req);
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const result = await svc.listPlans();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Plan Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ plans: result.value });
  });

  router.get("/admin/subscriptions/plans/:id", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
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
    const tenantId = getTenantId(req);
    const svc = deps.paymentService.getSubscriptionService(tenantId);
    const result = await svc.archivePlan(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Plan Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });
}

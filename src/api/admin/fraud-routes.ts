import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";

export function registerFraudRoutes(router: Router, deps: AdminRouteDeps): void {
  router.get("/admin/fraud/rules", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const result = await deps.paymentService.getFraudEngine(tenantId).getRules();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Fraud Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ rules: result.value });
  });

  router.post("/admin/fraud/rules", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const body = req.body as {
      name?: string; description?: string; ruleType?: string;
      config?: Record<string, unknown>; weight?: number; enabled?: boolean; id?: string;
    };
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
    const tenantId = getTenantId(req);
    const body = req.body as {
      name?: string; description?: string; ruleType?: string;
      config?: Record<string, unknown>; weight?: number; enabled?: boolean;
    };
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
    const tenantId = getTenantId(req);
    const result = await deps.paymentService.getFraudEngine(tenantId).deleteRule(String(req.params["id"]));
    if (!result.ok) {
      res.status(404).json({ type: "not_found", title: "Not Found", status: 404, detail: result.error.message });
      return;
    }
    res.json({ success: true });
  });

  router.get("/payments/:id/fraud", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
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
    const tenantId = getTenantId(req);
    const body = req.body as {
      amount?: number; currency?: string; customerId?: string; region?: string;
      customerPaymentCount?: number; customerAvgAmount?: number;
    };
    const result = await deps.paymentService.getFraudEngine(tenantId).evaluate(
      {
        amount: body.amount ?? 1000,
        currency: body.currency ?? "USD",
        customerId: body.customerId ?? "sim",
        orderId: "sim",
        items: [{ productId: "sim", quantity: 1, pricePerUnit: body.amount ?? 1000 }],
        region: body.region,
      },
      {
        customerPaymentCount: body.customerPaymentCount ?? 0,
        customerAvgAmount: body.customerAvgAmount ?? 0,
        customerRegion: body.region ?? "US",
      },
    );
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Fraud Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });
}

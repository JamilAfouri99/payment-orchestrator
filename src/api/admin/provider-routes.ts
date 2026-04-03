import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";

export function registerProviderRoutes(router: Router, deps: AdminRouteDeps): void {
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
    const tenantId = getTenantId(req);
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
    const tenantId = getTenantId(req);
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
}

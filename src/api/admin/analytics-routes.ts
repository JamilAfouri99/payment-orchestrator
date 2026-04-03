import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";
import { buildTimeWindow } from "../../analytics/analytics-service.js";

export function registerAnalyticsRoutes(router: Router, deps: AdminRouteDeps): void {
  router.get("/admin/analytics/metrics", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const analytics = deps.paymentService.getAnalyticsService(tenantId);
    const metricName = req.query["metricName"] as string | undefined;
    const providerId = req.query["providerId"] as string | undefined;
    const windowName = req.query["window"] as string | undefined;
    const from = req.query["from"] ? new Date(String(req.query["from"])) : undefined;
    const to = req.query["to"] ? new Date(String(req.query["to"])) : undefined;

    const result = await analytics.getMetrics({
      metricName,
      providerId,
      windowName: windowName as "1h" | "24h" | "7d" | "30d" | "90d" | undefined,
      from,
      to,
    });
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Analytics Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ metrics: result.value });
  });

  router.get("/admin/analytics/timeseries", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const analytics = deps.paymentService.getAnalyticsService(tenantId);
    const metricName = String(req.query["metricName"] ?? "authorization_rate");
    const from = new Date(String(req.query["from"] ?? new Date(Date.now() - 86_400_000).toISOString()));
    const to = new Date(String(req.query["to"] ?? new Date().toISOString()));
    const granularity = String(req.query["granularity"] ?? "1h");

    const result = await analytics.getTimeSeries(metricName, from, to, granularity);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Analytics Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ timeseries: result.value });
  });

  router.get("/admin/analytics/compare", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const analytics = deps.paymentService.getAnalyticsService(tenantId);
    const metricName = String(req.query["metricName"] ?? "authorization_rate");
    const windowName = String(req.query["window"] ?? "7d") as "1h" | "24h" | "7d" | "30d" | "90d";

    const now = new Date();
    const current = buildTimeWindow(windowName, now);
    const previous = buildTimeWindow(windowName, current.start);

    const result = await analytics.compareWindows(metricName, current, previous);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Analytics Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/analytics/compute", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const analytics = deps.paymentService.getAnalyticsService(tenantId);
    const windowName = String(req.body?.window ?? "24h") as "1h" | "24h" | "7d" | "30d" | "90d";
    const window = buildTimeWindow(windowName);

    const result = await analytics.computeMetrics(window);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Analytics Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ metrics: result.value, count: result.value.length });
  });
}

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

  router.post("/admin/reports", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const reportService = deps.paymentService.getReportService(tenantId);
    const body = req.body as {
      type?: string;
      dateRangeStart?: string;
      dateRangeEnd?: string;
      status?: string;
      providerId?: string;
      customerId?: string;
      format?: string;
    };

    if (!body.type || !body.dateRangeStart || !body.dateRangeEnd) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "type, dateRangeStart, and dateRangeEnd are required" });
      return;
    }

    const dateRange = { start: new Date(body.dateRangeStart), end: new Date(body.dateRangeEnd) };
    let result;

    switch (body.type) {
      case "transaction":
        result = await reportService.generateTransactionReport({
          dateRange,
          status: body.status,
          providerId: body.providerId,
          customerId: body.customerId,
          format: body.format as "csv" | "json" | undefined,
        });
        break;
      case "settlement":
        result = await reportService.generateSettlementReport(dateRange);
        break;
      case "dispute":
        result = await reportService.generateDisputeReport(dateRange);
        break;
      case "revenue":
        result = await reportService.generateRevenueReport(dateRange);
        break;
      default:
        res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: `Invalid report type: ${body.type}` });
        return;
    }

    if (!result.ok) {
      res.status(422).json({ type: "error", title: "Report Error", status: 422, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.get("/admin/reports", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const reportService = deps.paymentService.getReportService(tenantId);
    const result = await reportService.listReports();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Report Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ reports: result.value });
  });

  router.get("/admin/reports/:id", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const reportService = deps.paymentService.getReportService(tenantId);
    const result = await reportService.getReport(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Report Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/reports/:id/download", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const reportService = deps.paymentService.getReportService(tenantId);
    const result = await reportService.getReportData(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Report Error", status, detail: result.error.message });
      return;
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=report-${String(req.params["id"])}.csv`);
    res.send(result.value);
  });
}

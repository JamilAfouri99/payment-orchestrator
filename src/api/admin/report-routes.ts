import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";

export function registerReportRoutes(router: Router, deps: AdminRouteDeps): void {
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

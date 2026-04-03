import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";

export function registerSettlementRoutes(router: Router, deps: AdminRouteDeps): void {
  router.get("/admin/settlements", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const settlement = deps.paymentService.getSettlementService(tenantId);
    const limit = parseInt(String(req.query["limit"] ?? "50"), 10);
    const offset = parseInt(String(req.query["offset"] ?? "0"), 10);
    const result = await settlement.listSettlements(limit, offset);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Settlement Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/settlements/calculate", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const settlement = deps.paymentService.getSettlementService(tenantId);
    const body = req.body as {
      merchantAccountId?: string;
      periodStart?: string;
      periodEnd?: string;
      currency?: string;
      payoutMethod?: string;
    };

    if (!body.merchantAccountId || !body.periodStart || !body.periodEnd) {
      res.status(400).json({
        type: "validation", title: "Bad Request", status: 400,
        detail: "merchantAccountId, periodStart, and periodEnd are required",
      });
      return;
    }

    const result = await settlement.calculateSettlement(
      body.merchantAccountId,
      new Date(body.periodStart),
      new Date(body.periodEnd),
      body.currency,
      body.payoutMethod as "bank_transfer" | "wallet" | undefined,
    );
    if (!result.ok) {
      res.status(422).json({ type: "error", title: "Calculation Failed", status: 422, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.get("/admin/settlements/:id", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const settlement = deps.paymentService.getSettlementService(tenantId);
    const result = await settlement.getSettlement(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Settlement Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/settlements/:id/approve", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const settlement = deps.paymentService.getSettlementService(tenantId);
    const result = await settlement.approveSettlement(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : result.error.code === "INVALID_STATUS" ? 409 : 500;
      res.status(status).json({ type: "error", title: "Settlement Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/settlements/:id/process", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const settlement = deps.paymentService.getSettlementService(tenantId);
    const result = await settlement.processSettlement(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : result.error.code === "INVALID_STATUS" ? 409 : 500;
      res.status(status).json({ type: "error", title: "Settlement Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/settlements/:id/report", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const settlement = deps.paymentService.getSettlementService(tenantId);
    const result = await settlement.generateReport(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Settlement Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/settlements/:id/export", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const settlement = deps.paymentService.getSettlementService(tenantId);
    const result = await settlement.exportCsv(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Settlement Error", status, detail: result.error.message });
      return;
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=settlement-${String(req.params["id"])}.csv`);
    res.send(result.value);
  });
}

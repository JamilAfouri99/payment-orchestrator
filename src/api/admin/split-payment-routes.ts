import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";

export function registerSplitPaymentRoutes(router: Router, deps: AdminRouteDeps): void {
  router.post("/admin/splits", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const splitService = deps.paymentService.getSplitPaymentService(tenantId);
    const { paymentId, paymentAmount, splits } = req.body as {
      paymentId?: string;
      paymentAmount?: number;
      splits?: Array<{
        recipientType: string; recipientId: string; amount: number;
        currency?: string; splitType?: string; description?: string;
      }>;
    };

    if (!paymentId || !paymentAmount || !splits) {
      res.status(400).json({ type: "error", title: "Validation Error", status: 400, detail: "paymentId, paymentAmount, and splits[] are required" });
      return;
    }

    const result = await splitService.configureSplits(
      paymentId,
      paymentAmount,
      splits as Parameters<typeof splitService.configureSplits>[2],
    );
    if (!result.ok) {
      const statusMap: Record<string, number> = { VALIDATION: 400, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Split Error", status, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.post("/admin/splits/:paymentId/execute", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const splitService = deps.paymentService.getSplitPaymentService(tenantId);

    const result = await splitService.executeSplits(String(req.params["paymentId"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Split Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/splits/:paymentId", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const splitService = deps.paymentService.getSplitPaymentService(tenantId);

    const result = await splitService.getSplits(String(req.params["paymentId"]));
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Split Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });
}

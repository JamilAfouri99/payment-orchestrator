import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";

export function registerPayoutRoutes(router: Router, deps: AdminRouteDeps): void {
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

  router.post("/admin/payout-accounts", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const payoutService = deps.paymentService.getPayoutService(tenantId);
    const body = req.body as Partial<{
      merchantAccountId: string;
      type: string;
      bankName: string;
      accountNumberLast4: string;
      routingNumber: string;
      currency: string;
      country: string;
    }>;

    if (!body.merchantAccountId || !body.bankName || !body.accountNumberLast4) {
      res.status(400).json({ type: "error", title: "Validation Error", status: 400, detail: "merchantAccountId, bankName, and accountNumberLast4 are required" });
      return;
    }

    const result = await payoutService.createPayoutAccount({
      merchantAccountId: body.merchantAccountId,
      type: (body.type as "bank_account" | "wallet") ?? undefined,
      bankName: body.bankName,
      accountNumberLast4: body.accountNumberLast4,
      routingNumber: body.routingNumber ?? "",
      currency: body.currency,
      country: body.country,
    });
    if (!result.ok) {
      const statusMap: Record<string, number> = { VALIDATION: 400 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.get("/admin/payout-accounts", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const payoutService = deps.paymentService.getPayoutService(tenantId);
    const merchantAccountId = req.query["merchantAccountId"] as string | undefined;

    const result = await payoutService.listPayoutAccounts(merchantAccountId);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Payout Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/payout-accounts/:id", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const payoutService = deps.paymentService.getPayoutService(tenantId);

    const result = await payoutService.getPayoutAccount(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/payout-accounts/:id/verify", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const payoutService = deps.paymentService.getPayoutService(tenantId);

    const result = await payoutService.verifyPayoutAccount(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/payout-accounts/:id/disable", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const payoutService = deps.paymentService.getPayoutService(tenantId);

    const result = await payoutService.disablePayoutAccount(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/payout-accounts/:id/default", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const payoutService = deps.paymentService.getPayoutService(tenantId);

    const result = await payoutService.setDefaultPayoutAccount(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/payouts", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const payoutService = deps.paymentService.getPayoutService(tenantId);
    const body = req.body as Partial<{
      merchantAccountId: string;
      payoutAccountId: string;
      amount: number;
      currency: string;
      settlementIds: string[];
    }>;

    if (!body.merchantAccountId || !body.amount) {
      res.status(400).json({ type: "error", title: "Validation Error", status: 400, detail: "merchantAccountId and amount are required" });
      return;
    }

    const result = await payoutService.schedulePayout({
      merchantAccountId: body.merchantAccountId,
      payoutAccountId: body.payoutAccountId,
      amount: body.amount,
      currency: body.currency,
      settlementIds: body.settlementIds,
    });
    if (!result.ok) {
      const statusMap: Record<string, number> = { VALIDATION: 400, NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.get("/admin/payouts", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const payoutService = deps.paymentService.getPayoutService(tenantId);

    const result = await payoutService.listPayouts({
      status: (req.query["status"] as string | undefined) as "pending" | "processing" | "in_transit" | "paid" | "failed" | "canceled" | undefined,
      merchantAccountId: req.query["merchantAccountId"] as string | undefined,
      limit: req.query["limit"] ? Number(req.query["limit"]) : undefined,
      offset: req.query["offset"] ? Number(req.query["offset"]) : undefined,
    });
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Payout Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/payouts/:id", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const payoutService = deps.paymentService.getPayoutService(tenantId);

    const result = await payoutService.getPayout(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/payouts/:id/process", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const payoutService = deps.paymentService.getPayoutService(tenantId);

    const result = await payoutService.processPayout(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/payouts/:id/cancel", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const payoutService = deps.paymentService.getPayoutService(tenantId);

    const result = await payoutService.cancelPayout(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Payout Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });
}

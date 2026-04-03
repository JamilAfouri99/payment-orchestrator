import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";

export function registerPayoutAccountRoutes(router: Router, deps: AdminRouteDeps): void {
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
}

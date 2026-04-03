import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";

export function registerCheckoutRoutes(router: Router, deps: AdminRouteDeps): void {
  router.post("/admin/3ds/initiate", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const threeDSecure = deps.paymentService.getThreeDSecureService(tenantId);
    const body = req.body as {
      paymentId?: string;
      amount?: number;
      currency?: string;
      region?: string;
      fraudScore?: number;
      isTrustedBeneficiary?: boolean;
      version?: string;
    };

    if (!body.paymentId || !body.amount) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "paymentId and amount are required" });
      return;
    }

    const result = await threeDSecure.initiate(body.paymentId, {
      amount: body.amount,
      currency: body.currency ?? "USD",
      region: body.region,
      fraudScore: body.fraudScore,
      isTrustedBeneficiary: body.isTrustedBeneficiary,
      version: body.version as "3ds1" | "3ds2" | undefined,
    });
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "3DS Error", status: 500, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.post("/admin/3ds/:id/complete", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const threeDSecure = deps.paymentService.getThreeDSecureService(tenantId);
    const body = req.body as { outcome?: string };
    const outcome = body.outcome === "failed" ? "failed" : "authenticated";

    const result = await threeDSecure.complete(String(req.params["id"]), outcome);
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, ALREADY_COMPLETED: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "3DS Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/3ds/payment/:paymentId", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const threeDSecure = deps.paymentService.getThreeDSecureService(tenantId);
    const result = await threeDSecure.check(String(req.params["paymentId"]));
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "3DS Error", status: 500, detail: result.error.message });
      return;
    }
    if (!result.value) {
      res.status(404).json({ type: "not_found", title: "Not Found", status: 404, detail: "No 3DS record for this payment" });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/3ds/check", (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const threeDSecure = deps.paymentService.getThreeDSecureService(tenantId);
    const body = req.body as {
      amount?: number;
      currency?: string;
      region?: string;
      fraudScore?: number;
      isTrustedBeneficiary?: boolean;
    };

    if (!body.amount) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "amount is required" });
      return;
    }

    const required = threeDSecure.shouldRequire({
      amount: body.amount,
      currency: body.currency ?? "USD",
      region: body.region,
      fraudScore: body.fraudScore,
      isTrustedBeneficiary: body.isTrustedBeneficiary,
    });
    res.json({ required });
  });

  router.post("/checkout/sessions", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const checkout = deps.paymentService.getCheckoutService(tenantId);
    const body = req.body as Record<string, unknown>;

    const result = await checkout.createSession(body as never);
    if (!result.ok) {
      const statusMap: Record<string, number> = { VALIDATION: 400 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Checkout Error", status, detail: result.error.message });
      return;
    }
    res.status(201).json({
      ...result.value,
      checkoutUrl: `/checkout/${result.value.id}`,
    });
  });

  router.get("/checkout/sessions", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const checkout = deps.paymentService.getCheckoutService(tenantId);
    const status = req.query["status"] ? String(req.query["status"]) : undefined;
    const limit = req.query["limit"] ? parseInt(String(req.query["limit"]), 10) : undefined;

    const result = await checkout.listSessions({ status, limit });
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Checkout Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ sessions: result.value });
  });

  router.get("/checkout/sessions/:id", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const checkout = deps.paymentService.getCheckoutService(tenantId);
    const result = await checkout.getSession(String(req.params["id"]));
    if (!result.ok) {
      const statusCode = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(statusCode).json({ type: "error", title: "Checkout Error", status: statusCode, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/checkout/sessions/:id/complete", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const checkout = deps.paymentService.getCheckoutService(tenantId);
    const body = req.body as { paymentId?: string; paymentMethodType?: string };

    if (!body.paymentId || !body.paymentMethodType) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "paymentId and paymentMethodType are required" });
      return;
    }

    const result = await checkout.completeSession(String(req.params["id"]), body.paymentId, body.paymentMethodType);
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, EXPIRED: 410, ALREADY_COMPLETE: 409 };
      const statusCode = statusMap[result.error.code] ?? 500;
      res.status(statusCode).json({ type: "error", title: "Checkout Error", status: statusCode, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/checkout/sessions/:id/expire", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const checkout = deps.paymentService.getCheckoutService(tenantId);
    const result = await checkout.expireSession(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, ALREADY_COMPLETE: 409 };
      const statusCode = statusMap[result.error.code] ?? 500;
      res.status(statusCode).json({ type: "error", title: "Checkout Error", status: statusCode, detail: result.error.message });
      return;
    }
    res.json({ success: true });
  });

  router.get("/checkout/analytics", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const checkout = deps.paymentService.getCheckoutService(tenantId);
    const result = await checkout.getConversionStats();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Checkout Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });
}

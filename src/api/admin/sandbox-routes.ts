import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";

export function registerSandboxRoutes(router: Router, deps: AdminRouteDeps): void {
  router.get("/admin/sandbox/test-cards", (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const sandbox = deps.paymentService.getSandboxService(tenantId);
    res.json({ cards: sandbox.getTestCards() });
  });

  router.post("/admin/sandbox/trigger-dispute", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const { paymentId } = req.body as { paymentId?: string };
    if (!paymentId) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "paymentId is required" });
      return;
    }
    const sandbox = deps.paymentService.getSandboxService(tenantId);
    const result = await sandbox.triggerDispute(paymentId);
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Sandbox Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/sandbox/reset", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const sandbox = deps.paymentService.getSandboxService(tenantId);
    const result = await sandbox.resetSandboxData();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Sandbox Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/payment-methods", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const pmService = deps.paymentService.getPaymentMethodService(tenantId);
    const body = req.body as Record<string, unknown>;

    const result = await pmService.create(body as never);
    if (!result.ok) {
      const statusMap: Record<string, number> = { VALIDATION: 400, NOT_ELIGIBLE: 422 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Payment Method Error", status, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.get("/admin/payment-methods", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const pmService = deps.paymentService.getPaymentMethodService(tenantId);
    const customerId = String(req.query["customerId"] ?? "");

    if (!customerId) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "customerId query param is required" });
      return;
    }

    const result = await pmService.listByCustomer(customerId);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Payment Method Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ methods: result.value });
  });

  router.get("/admin/payment-methods/supported", (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const pmService = deps.paymentService.getPaymentMethodService(tenantId);
    const currency = String(req.query["currency"] ?? "USD");
    const country = req.query["country"] ? String(req.query["country"]) : undefined;
    const methods = pmService.getSupportedMethods(currency, country);
    res.json({ methods });
  });

  router.get("/admin/payment-methods/:id", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const pmService = deps.paymentService.getPaymentMethodService(tenantId);
    const result = await pmService.get(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Payment Method Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/payment-methods/:id/default", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const pmService = deps.paymentService.getPaymentMethodService(tenantId);
    const body = req.body as { customerId?: string };

    if (!body.customerId) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "customerId is required" });
      return;
    }

    const result = await pmService.setDefault(body.customerId, String(req.params["id"]));
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Payment Method Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/payment-methods/:id/revoke", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const pmService = deps.paymentService.getPaymentMethodService(tenantId);
    const result = await pmService.revoke(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Payment Method Error", status, detail: result.error.message });
      return;
    }
    res.json({ success: true });
  });
}

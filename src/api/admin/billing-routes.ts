import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";
import type { InvoiceStatus } from "../../billing/billing-engine.js";

export function registerBillingRoutes(router: Router, deps: AdminRouteDeps): void {
  router.get("/admin/invoices", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const billing = deps.paymentService.getBillingEngine(tenantId);
    const status = req.query["status"] as InvoiceStatus | undefined;
    const subscriptionId = req.query["subscriptionId"] as string | undefined;
    const result = await billing.listInvoices({ status, subscriptionId });
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Invoice Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ invoices: result.value });
  });

  router.get("/admin/invoices/:id", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const billing = deps.paymentService.getBillingEngine(tenantId);
    const result = await billing.getInvoice(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Invoice Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/invoices/:id/pay", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const billing = deps.paymentService.getBillingEngine(tenantId);
    const result = await billing.attemptPayment(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : result.error.code === "INVALID_STATUS" ? 409 : 422;
      res.status(status).json({ type: "error", title: "Invoice Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/invoices/:id/void", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const billing = deps.paymentService.getBillingEngine(tenantId);
    const result = await billing.voidInvoice(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : result.error.code === "INVALID_STATUS" ? 409 : 500;
      res.status(status).json({ type: "error", title: "Invoice Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/billing/process", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const billing = deps.paymentService.getBillingEngine(tenantId);
    const result = await billing.processDueSubscriptions();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Billing Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/dunning/config", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const dunning = deps.paymentService.getDunningService(tenantId);
    const result = await dunning.getConfig();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Dunning Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.put("/admin/dunning/config", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const dunning = deps.paymentService.getDunningService(tenantId);
    const result = await dunning.updateConfig(req.body as Record<string, unknown>);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Dunning Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/dunning/active", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const dunning = deps.paymentService.getDunningService(tenantId);
    const result = await dunning.getActiveDunningFlows();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Dunning Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ flows: result.value });
  });

  router.post("/admin/dunning/process", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const dunning = deps.paymentService.getDunningService(tenantId);
    const result = await dunning.processRetries();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Dunning Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/dunning/analytics", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const dunning = deps.paymentService.getDunningService(tenantId);
    const result = await dunning.getRetryAnalytics();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Dunning Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });
}

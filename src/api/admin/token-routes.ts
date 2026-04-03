import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";

export function registerTokenRoutes(router: Router, deps: AdminRouteDeps): void {
  router.get("/tokens", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const customerId = String(req.query["customerId"] ?? "");
    if (!customerId) {
      try {
        const tokens = await deps.prisma.paymentToken.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          take: 100,
        });
        res.json({ tokens });
      } catch {
        res.status(500).json({ type: "error", title: "Token Error", status: 500, detail: "Failed to list tokens" });
      }
      return;
    }
    const result = await deps.paymentService.getTokenVault(tenantId).listByCustomer(customerId);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Token Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ tokens: result.value });
  });

  router.get("/tokens/:token", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const result = await deps.paymentService.getTokenVault(tenantId).getToken(String(req.params["token"]));
    if (!result.ok) {
      res.status(404).json({ type: "not_found", title: "Not Found", status: 404, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/tokens/revoke/:token", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const result = await deps.paymentService.getTokenVault(tenantId).revokeToken(String(req.params["token"]));
    if (!result.ok) {
      res.status(404).json({ type: "not_found", title: "Not Found", status: 404, detail: result.error.message });
      return;
    }
    res.json({ success: true });
  });
}

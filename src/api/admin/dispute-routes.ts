import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";

export function registerDisputeRoutes(router: Router, deps: AdminRouteDeps): void {
  router.post("/admin/disputes", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const disputeService = deps.paymentService.getDisputeService(tenantId);
    const { paymentId, reason, amount, type, merchantAccountId } = req.body as {
      paymentId?: string;
      reason?: string;
      amount?: number;
      type?: string;
      merchantAccountId?: string;
    };

    if (!paymentId || !reason || !amount) {
      res.status(400).json({ type: "error", title: "Validation Error", status: 400, detail: "paymentId, reason, and amount are required" });
      return;
    }

    const result = await disputeService.receiveDispute(
      paymentId,
      reason as Parameters<typeof disputeService.receiveDispute>[1],
      amount,
      type as Parameters<typeof disputeService.receiveDispute>[3],
      merchantAccountId,
    );
    if (!result.ok) {
      const status = result.error.code === "VALIDATION" ? 400 : 500;
      res.status(status).json({ type: "error", title: "Dispute Error", status, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.get("/admin/disputes", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const disputeService = deps.paymentService.getDisputeService(tenantId);
    const { status, paymentId, limit, offset } = req.query as {
      status?: string;
      paymentId?: string;
      limit?: string;
      offset?: string;
    };

    const result = await disputeService.listDisputes({
      status: status as Parameters<typeof disputeService.listDisputes>[0] extends infer F ? F extends { status?: infer S } ? S : undefined : undefined,
      paymentId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Dispute Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/disputes/chargeback-rate", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const disputeService = deps.paymentService.getDisputeService(tenantId);
    const { merchantAccountId } = req.query as { merchantAccountId?: string };

    const result = await disputeService.getChargebackRate(merchantAccountId);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Dispute Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/disputes/:id", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const disputeService = deps.paymentService.getDisputeService(tenantId);
    const result = await disputeService.getDispute(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Dispute Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/disputes/:id/evidence", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const disputeService = deps.paymentService.getDisputeService(tenantId);
    const { evidence } = req.body as { evidence?: Array<{ type: string; description: string; content: string }> };

    if (!evidence || !Array.isArray(evidence) || evidence.length === 0) {
      res.status(400).json({ type: "error", title: "Validation Error", status: 400, detail: "evidence array is required" });
      return;
    }

    const result = await disputeService.submitEvidence(
      String(req.params["id"]),
      evidence as Parameters<typeof disputeService.submitEvidence>[1],
    );
    if (!result.ok) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        INVALID_STATUS: 409,
        EVIDENCE_DEADLINE_PASSED: 410,
        VALIDATION: 400,
      };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Dispute Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/disputes/:id/resolve", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const disputeService = deps.paymentService.getDisputeService(tenantId);
    const { outcome } = req.body as { outcome?: string };

    if (!outcome || (outcome !== "won" && outcome !== "lost")) {
      res.status(400).json({ type: "error", title: "Validation Error", status: 400, detail: "outcome must be 'won' or 'lost'" });
      return;
    }

    const result = await disputeService.resolveDispute(String(req.params["id"]), outcome);
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Dispute Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/disputes/:id/accept", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const disputeService = deps.paymentService.getDisputeService(tenantId);

    const result = await disputeService.acceptDispute(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Dispute Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });
}

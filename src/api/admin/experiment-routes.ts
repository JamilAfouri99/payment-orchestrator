import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";

export function registerExperimentRoutes(router: Router, deps: AdminRouteDeps): void {
  router.post("/admin/experiments", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const experimentService = deps.paymentService.getExperimentService(tenantId);
    const body = req.body as {
      name?: string;
      description?: string;
      controlProviderId?: string;
      controlWeight?: number;
      variants?: { name: string; providerId: string; weight: number }[];
      trafficAllocation?: number;
      targetMetrics?: string[];
      minimumSampleSize?: number;
      confidenceLevel?: number;
    };

    if (!body.name || !body.controlProviderId || !body.variants) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "name, controlProviderId, and variants are required" });
      return;
    }

    const result = await experimentService.createExperiment({
      name: body.name,
      description: body.description,
      controlProviderId: body.controlProviderId,
      controlWeight: body.controlWeight,
      variants: body.variants,
      trafficAllocation: body.trafficAllocation,
      targetMetrics: body.targetMetrics,
      minimumSampleSize: body.minimumSampleSize,
      confidenceLevel: body.confidenceLevel,
    });
    if (!result.ok) {
      const statusMap: Record<string, number> = { VALIDATION: 400 };
      const status = statusMap[result.error.code] ?? 422;
      res.status(status).json({ type: "error", title: "Experiment Error", status, detail: result.error.message });
      return;
    }
    res.status(201).json(result.value);
  });

  router.get("/admin/experiments", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const experimentService = deps.paymentService.getExperimentService(tenantId);
    const result = await experimentService.listExperiments();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Experiment Error", status: 500, detail: result.error.message });
      return;
    }
    res.json({ experiments: result.value });
  });

  router.get("/admin/experiments/:id", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const experimentService = deps.paymentService.getExperimentService(tenantId);
    const result = await experimentService.getExperiment(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Experiment Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/experiments/:id/start", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const experimentService = deps.paymentService.getExperimentService(tenantId);
    const result = await experimentService.startExperiment(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Experiment Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/experiments/:id/pause", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const experimentService = deps.paymentService.getExperimentService(tenantId);
    const result = await experimentService.pauseExperiment(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Experiment Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/experiments/:id/complete", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const experimentService = deps.paymentService.getExperimentService(tenantId);
    const result = await experimentService.completeExperiment(String(req.params["id"]));
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Experiment Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/experiments/:id/results", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const experimentService = deps.paymentService.getExperimentService(tenantId);
    const result = await experimentService.getResults(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Experiment Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/experiments/:id/declare-winner", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const experimentService = deps.paymentService.getExperimentService(tenantId);
    const body = req.body as { variantName?: string };

    if (!body.variantName) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "variantName is required" });
      return;
    }

    const result = await experimentService.declareWinner(String(req.params["id"]), body.variantName);
    if (!result.ok) {
      const statusMap: Record<string, number> = { NOT_FOUND: 404, VALIDATION: 400, INVALID_STATUS: 409 };
      const status = statusMap[result.error.code] ?? 500;
      res.status(status).json({ type: "error", title: "Experiment Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });
}

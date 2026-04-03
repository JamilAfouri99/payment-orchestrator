import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getRecentLogs } from "../../core/logger.js";

export function registerObservabilityRoutes(router: Router, deps: AdminRouteDeps): void {
  router.get("/admin/metrics", (_req: Request, res: Response) => {
    res.json(deps.metrics.snapshot());
  });

  router.post("/admin/metrics/reset", (_req: Request, res: Response) => {
    deps.metrics.reset();
    res.json({ success: true });
  });

  router.get("/admin/logs", (req: Request, res: Response) => {
    const limit = parseInt(String(req.query["limit"] ?? "100"), 10);
    res.json({ logs: getRecentLogs(limit) });
  });

  router.get("/admin/bulkheads", (_req: Request, res: Response) => {
    res.json({ bulkheads: deps.bulkheads.map((b) => b.getStats()) });
  });
}

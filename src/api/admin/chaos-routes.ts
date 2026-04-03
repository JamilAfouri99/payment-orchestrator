import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";

export function registerChaosRoutes(router: Router, deps: AdminRouteDeps): void {
  router.get("/admin/chaos", (_req: Request, res: Response) => {
    res.json({ services: deps.chaos.getAll() });
  });

  router.post("/admin/chaos", (req: Request, res: Response) => {
    const { service, failureRate, latencyMs, enabled } = req.body as {
      service?: string; failureRate?: number; latencyMs?: number; enabled?: boolean;
    };
    if (!service) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "Service name required" });
      return;
    }
    deps.chaos.setConfig(service, {
      ...(failureRate !== undefined ? { failureRate } : {}),
      ...(latencyMs !== undefined ? { latencyMs } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    });
    deps.logger.info("chaos_config_updated", { service, failureRate, latencyMs, enabled });
    res.json({ services: deps.chaos.getAll() });
  });

  router.post("/admin/chaos/reset", (_req: Request, res: Response) => {
    deps.chaos.reset();
    deps.logger.info("chaos_config_reset");
    res.json({ success: true, services: deps.chaos.getAll() });
  });
}

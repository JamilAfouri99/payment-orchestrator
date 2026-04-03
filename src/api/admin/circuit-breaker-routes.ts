import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";

export function registerCircuitBreakerRoutes(router: Router, deps: AdminRouteDeps): void {
  router.get("/admin/circuit-breakers", (_req: Request, res: Response) => {
    res.json({ breakers: deps.cbRegistry.getAll() });
  });

  router.post("/admin/circuit-breakers/:name/reset", (req: Request, res: Response) => {
    const name = String(req.params["name"]);
    const success = deps.cbRegistry.reset(name);
    if (!success) {
      res.status(404).json({ type: "not_found", title: "Not Found", status: 404, detail: `Circuit breaker "${name}" not found` });
      return;
    }
    deps.logger.info("circuit_breaker_reset", { name });
    res.json({ success: true });
  });
}

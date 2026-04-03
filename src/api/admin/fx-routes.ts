import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";

export function registerFxRoutes(router: Router, deps: AdminRouteDeps): void {
  router.get("/admin/fx/rates", (_req: Request, res: Response) => {
    res.json({ rates: deps.fxService.getAllRates() });
  });

  router.post("/admin/fx/rates", (req: Request, res: Response) => {
    const { from, to, rate, spreadBps } = req.body as {
      from?: string; to?: string; rate?: number; spreadBps?: number;
    };
    if (!from || !to || rate === undefined) {
      res.status(400).json({ type: "validation", title: "Bad Request", status: 400, detail: "from, to, and rate are required" });
      return;
    }
    deps.fxService.setRate(from, to, rate, spreadBps ?? 50);
    res.json({ success: true, rates: deps.fxService.getAllRates() });
  });
}

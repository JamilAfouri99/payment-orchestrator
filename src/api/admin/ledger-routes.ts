import type { Request, Response } from "express";
import type { Router } from "express";
import type { AdminRouteDeps } from "../admin-routes.js";
import { getTenantId } from "../route-helpers.js";

export function registerLedgerRoutes(router: Router, deps: AdminRouteDeps): void {
  router.get("/admin/ledger/accounts", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const ledger = deps.paymentService.getLedgerService(tenantId);
    const result = await ledger.listAccounts();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Ledger Error", status: 500, detail: result.error.message });
      return;
    }

    const accountsWithBalances = [];
    for (const account of result.value) {
      const balanceResult = await ledger.getBalance(account.id);
      accountsWithBalances.push({
        ...account,
        balance: balanceResult.ok ? balanceResult.value.balance : 0,
      });
    }

    res.json({ accounts: accountsWithBalances });
  });

  router.get("/admin/ledger/accounts/:id/balance", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const ledger = deps.paymentService.getLedgerService(tenantId);
    const asOf = req.query["asOf"] ? new Date(String(req.query["asOf"])) : undefined;
    const result = await ledger.getBalance(String(req.params["id"]), asOf);
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Ledger Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/ledger/accounts/:id/statement", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const ledger = deps.paymentService.getLedgerService(tenantId);
    const from = req.query["from"] ? new Date(String(req.query["from"])) : new Date(Date.now() - 30 * 86_400_000);
    const to = req.query["to"] ? new Date(String(req.query["to"])) : new Date();
    const result = await ledger.getStatement(String(req.params["id"]), from, to);
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Ledger Error", status, detail: result.error.message });
      return;
    }
    res.json({ entries: result.value });
  });

  router.get("/admin/ledger/transactions", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const ledger = deps.paymentService.getLedgerService(tenantId);
    const limit = parseInt(String(req.query["limit"] ?? "50"), 10);
    const offset = parseInt(String(req.query["offset"] ?? "0"), 10);
    const result = await ledger.listTransactions(limit, offset);
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Ledger Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.get("/admin/ledger/transactions/:id", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const ledger = deps.paymentService.getLedgerService(tenantId);
    const result = await ledger.getTransaction(String(req.params["id"]));
    if (!result.ok) {
      const status = result.error.code === "NOT_FOUND" ? 404 : 500;
      res.status(status).json({ type: "error", title: "Ledger Error", status, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });

  router.post("/admin/ledger/reconcile", async (req: Request, res: Response) => {
    const tenantId = getTenantId(req);
    const ledger = deps.paymentService.getLedgerService(tenantId);
    const result = await ledger.reconcile();
    if (!result.ok) {
      res.status(500).json({ type: "error", title: "Ledger Error", status: 500, detail: result.error.message });
      return;
    }
    res.json(result.value);
  });
}

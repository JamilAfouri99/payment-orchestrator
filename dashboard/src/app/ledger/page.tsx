"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchLedgerAccounts,
  fetchLedgerTransactions,
  fetchAccountStatement,
  runReconciliation,
  type LedgerAccountRecord,
  type LedgerTransactionRecord,
  type LedgerEntryRecord,
  type ReconciliationResult,
} from "@/lib/api";

const ACCOUNT_TYPE_STYLES: Record<string, string> = {
  asset: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  liability: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  revenue: "bg-success/15 text-success border-success/30",
  expense: "bg-danger/15 text-danger border-danger/30",
};

const TXN_TYPE_STYLES: Record<string, string> = {
  payment_captured: "bg-success/15 text-success",
  refund: "bg-warning/15 text-warning",
  settlement: "bg-accent/15 text-accent",
  fee: "bg-purple-500/15 text-purple-400",
  chargeback: "bg-danger/15 text-danger",
  adjustment: "bg-muted/15 text-muted",
};

type Tab = "accounts" | "transactions" | "reconciliation";

export default function LedgerPage() {
  const [tab, setTab] = useState<Tab>("accounts");
  const [accounts, setAccounts] = useState<LedgerAccountRecord[]>([]);
  const [transactions, setTransactions] = useState<LedgerTransactionRecord[]>([]);
  const [txnTotal, setTxnTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Statement drill-down
  const [selectedAccount, setSelectedAccount] = useState<LedgerAccountRecord | null>(null);
  const [statement, setStatement] = useState<LedgerEntryRecord[]>([]);
  const [statementLoading, setStatementLoading] = useState(false);

  // Reconciliation
  const [reconciling, setReconciling] = useState(false);
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await fetchLedgerAccounts();
      setAccounts(data.accounts);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    try {
      const data = await fetchLedgerTransactions(50, 0);
      setTransactions(data.transactions);
      setTxnTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    if (tab === "accounts") loadAccounts();
    else if (tab === "transactions") loadTransactions();
    else setLoading(false);
  }, [tab, loadAccounts, loadTransactions]);

  async function handleDrillDown(account: LedgerAccountRecord) {
    setSelectedAccount(account);
    setStatementLoading(true);
    try {
      const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const to = new Date().toISOString();
      const data = await fetchAccountStatement(account.id, from, to);
      setStatement(data.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load statement");
    } finally {
      setStatementLoading(false);
    }
  }

  async function handleReconcile() {
    setReconciling(true);
    try {
      const result = await runReconciliation();
      setReconciliation(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reconciliation failed");
    } finally {
      setReconciling(false);
    }
  }

  function formatCents(cents: number): string {
    const isNegative = cents < 0;
    const abs = Math.abs(cents);
    const formatted = `$${(abs / 100).toFixed(2)}`;
    return isNegative ? `-${formatted}` : formatted;
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Double-Entry Ledger</h2>
        <p className="text-muted text-sm mt-1">
          Every money movement creates exactly two entries — debits always equal credits
        </p>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Tab navigation */}
      <div className="flex gap-1 bg-card border border-card-border rounded-lg p-1">
        {(["accounts", "transactions", "reconciliation"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setSelectedAccount(null); }}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t
                ? "bg-accent/15 text-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Accounts tab */}
      {tab === "accounts" && !selectedAccount && (
        <>
          {loading ? (
            <div className="text-center text-muted text-sm animate-pulse py-8">Loading accounts...</div>
          ) : accounts.length === 0 ? (
            <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted text-sm">
              No ledger accounts yet. Process a payment to initialize the ledger.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {accounts.map((account) => (
                <button
                  key={account.id}
                  onClick={() => handleDrillDown(account)}
                  className="bg-card border border-card-border rounded-xl p-5 text-left hover:border-accent/50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-sm font-medium">
                      {account.name.replace(/_/g, " ")}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                        ACCOUNT_TYPE_STYLES[account.type] ?? "bg-muted/15 text-muted border-muted/30"
                      }`}
                    >
                      {account.type}
                    </span>
                  </div>
                  <p className={`text-2xl font-bold ${account.balance >= 0 ? "text-success" : "text-danger"}`}>
                    {formatCents(account.balance)}
                  </p>
                  <p className="text-xs text-muted mt-1">{account.currency}</p>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Account statement drill-down */}
      {tab === "accounts" && selectedAccount && (
        <div className="space-y-4">
          <button
            onClick={() => setSelectedAccount(null)}
            className="text-sm text-accent hover:underline"
          >
            &larr; Back to accounts
          </button>
          <div className="bg-card border border-card-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-lg">
                  {selectedAccount.name.replace(/_/g, " ")}
                </h3>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                    ACCOUNT_TYPE_STYLES[selectedAccount.type] ?? "bg-muted/15 text-muted border-muted/30"
                  }`}
                >
                  {selectedAccount.type}
                </span>
              </div>
              <p className={`text-2xl font-bold ${selectedAccount.balance >= 0 ? "text-success" : "text-danger"}`}>
                {formatCents(selectedAccount.balance)}
              </p>
            </div>
            <p className="text-xs text-muted">Last 30 days</p>
          </div>

          <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            <div className="p-5 border-b border-card-border">
              <h3 className="font-semibold">Statement</h3>
              <p className="text-xs text-muted mt-0.5">
                {statementLoading ? "Loading..." : `${statement.length} entries`}
              </p>
            </div>
            {statementLoading ? (
              <div className="p-8 text-center text-muted text-sm animate-pulse">Loading entries...</div>
            ) : statement.length === 0 ? (
              <div className="p-8 text-center text-muted text-sm">No entries in this period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted border-b border-card-border">
                      <th className="px-5 py-3 font-medium">Date</th>
                      <th className="px-5 py-3 font-medium">Direction</th>
                      <th className="px-5 py-3 font-medium text-right">Amount</th>
                      <th className="px-5 py-3 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-t border-card-border/50 hover:bg-card-border/20 transition-colors"
                      >
                        <td className="px-5 py-3 text-xs text-muted">
                          {new Date(entry.effectiveAt).toLocaleString()}
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              entry.direction === "debit"
                                ? "bg-blue-500/15 text-blue-400"
                                : "bg-success/15 text-success"
                            }`}
                          >
                            {entry.direction}
                          </span>
                        </td>
                        <td className={`px-5 py-3 text-right font-mono text-sm ${
                          entry.direction === "debit" ? "text-blue-400" : "text-success"
                        }`}>
                          {entry.direction === "debit" ? "+" : "-"}{formatCents(entry.amount)}
                        </td>
                        <td className="px-5 py-3 text-xs text-muted max-w-xs truncate">
                          {typeof entry.metadata["description"] === "string"
                            ? entry.metadata["description"]
                            : JSON.stringify(entry.metadata)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Transactions tab */}
      {tab === "transactions" && (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="p-5 border-b border-card-border">
            <h3 className="font-semibold">Ledger Transactions</h3>
            <p className="text-xs text-muted mt-0.5">
              {loading ? "Loading..." : `${txnTotal} total`}
            </p>
          </div>
          {loading ? (
            <div className="p-8 text-center text-muted text-sm animate-pulse">Loading transactions...</div>
          ) : transactions.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm">No ledger transactions yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-card-border">
                    <th className="px-5 py-3 font-medium">Type</th>
                    <th className="px-5 py-3 font-medium">Description</th>
                    <th className="px-5 py-3 font-medium">Entries</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((txn) => {
                    const debitTotal = txn.entries
                      .filter((e) => e.direction === "debit")
                      .reduce((s, e) => s + e.amount, 0);
                    return (
                      <tr
                        key={txn.id}
                        className="border-t border-card-border/50 hover:bg-card-border/20 transition-colors"
                      >
                        <td className="px-5 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              TXN_TYPE_STYLES[txn.type] ?? "bg-muted/15 text-muted"
                            }`}
                          >
                            {txn.type.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-muted max-w-xs truncate">
                          {txn.description || txn.idempotencyKey}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-col gap-0.5">
                            {txn.entries.map((entry) => (
                              <span
                                key={entry.id}
                                className={`text-xs font-mono ${
                                  entry.direction === "debit" ? "text-blue-400" : "text-success"
                                }`}
                              >
                                {entry.direction === "debit" ? "DR" : "CR"} {formatCents(entry.amount)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-success/15 text-success border border-success/30">
                            {txn.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-muted">
                          {new Date(txn.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    );

                    void debitTotal;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Reconciliation tab */}
      {tab === "reconciliation" && (
        <div className="space-y-6">
          <div className="bg-card border border-card-border rounded-xl p-6">
            <h3 className="font-semibold mb-2">Integrity Check</h3>
            <p className="text-sm text-muted mb-4">
              Verify that all debits equal all credits system-wide, check for orphaned entries,
              and validate every transaction is balanced.
            </p>
            <button
              onClick={handleReconcile}
              disabled={reconciling}
              className="px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-50"
            >
              {reconciling ? "Running..." : "Run Reconciliation"}
            </button>
          </div>

          {reconciliation && (
            <div className={`bg-card border rounded-xl p-6 ${
              reconciliation.passed ? "border-success/30" : "border-danger/30"
            }`}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  reconciliation.passed ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
                }`}>
                  {reconciliation.passed ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </div>
                <div>
                  <h4 className={`font-semibold ${reconciliation.passed ? "text-success" : "text-danger"}`}>
                    {reconciliation.passed ? "All Checks Passed" : "Discrepancies Found"}
                  </h4>
                  <p className="text-xs text-muted">
                    {new Date(reconciliation.checkedAt).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted uppercase tracking-wider mb-1">Total Debits</p>
                  <p className="text-lg font-bold font-mono">{formatCents(reconciliation.totalDebits)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted uppercase tracking-wider mb-1">Total Credits</p>
                  <p className="text-lg font-bold font-mono">{formatCents(reconciliation.totalCredits)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted uppercase tracking-wider mb-1">Discrepancy</p>
                  <p className={`text-lg font-bold font-mono ${reconciliation.discrepancy === 0 ? "text-success" : "text-danger"}`}>
                    {formatCents(reconciliation.discrepancy)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted uppercase tracking-wider mb-1">Issues</p>
                  <p className={`text-lg font-bold ${reconciliation.orphanedEntries + reconciliation.invalidTransactions === 0 ? "text-success" : "text-danger"}`}>
                    {reconciliation.orphanedEntries + reconciliation.invalidTransactions}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Accounting principle note */}
      <div className="bg-accent/5 border border-accent/20 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-accent mb-2">Double-Entry Accounting</h3>
        <p className="text-sm text-muted leading-relaxed">
          Every financial transaction creates at least two entries: a debit and a credit of equal value.
          Assets and expenses increase with debits. Liabilities and revenue increase with credits.
          The global invariant — total debits equals total credits — is enforced atomically on every transaction
          and verified by the reconciliation check.
        </p>
      </div>
    </div>
  );
}

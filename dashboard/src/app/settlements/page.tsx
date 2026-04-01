"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchSettlements,
  calculateSettlement,
  approveSettlement,
  processSettlement,
  fetchSettlementReport,
  getSettlementExportUrl,
  type SettlementRecord,
  type SettlementReportData,
} from "@/lib/api";

const STATUS_STYLES: Record<string, string> = {
  calculating: "bg-muted/15 text-muted border-muted/30",
  pending_approval: "bg-warning/15 text-warning border-warning/30",
  approved: "bg-accent/15 text-accent border-accent/30",
  processing: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  settled: "bg-success/15 text-success border-success/30",
  failed: "bg-danger/15 text-danger border-danger/30",
};

export default function SettlementsPage() {
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Generate settlement form
  const [showForm, setShowForm] = useState(false);
  const [formMerchantId, setFormMerchantId] = useState("");
  const [formStart, setFormStart] = useState("");
  const [formEnd, setFormEnd] = useState("");
  const [generating, setGenerating] = useState(false);

  // Detail view
  const [selected, setSelected] = useState<SettlementRecord | null>(null);
  const [report, setReport] = useState<SettlementReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchSettlements(50, 0);
      setSettlements(data.settlements);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settlements");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!formMerchantId || !formStart || !formEnd) return;
    setGenerating(true);
    try {
      await calculateSettlement({
        merchantAccountId: formMerchantId,
        periodStart: new Date(formStart).toISOString(),
        periodEnd: new Date(formEnd).toISOString(),
      });
      setShowForm(false);
      setFormMerchantId("");
      setFormStart("");
      setFormEnd("");
      setLoading(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate settlement");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSelectSettlement(s: SettlementRecord) {
    setSelected(s);
    setReportLoading(true);
    try {
      const data = await fetchSettlementReport(s.id);
      setReport(data);
    } catch {
      setReport(null);
    } finally {
      setReportLoading(false);
    }
  }

  async function handleApprove(id: string) {
    setActionLoading(true);
    try {
      const updated = await approveSettlement(id);
      setSelected(updated);
      setSettlements((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleProcess(id: string) {
    setActionLoading(true);
    try {
      const updated = await processSettlement(id);
      setSelected(updated);
      setSettlements((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process");
    } finally {
      setActionLoading(false);
    }
  }

  function formatCents(cents: number): string {
    return `$${(Math.abs(cents) / 100).toFixed(2)}`;
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString();
  }

  // Summary stats
  const pendingCount = settlements.filter((s) => s.status === "pending_approval").length;
  const settledCount = settlements.filter((s) => s.status === "settled").length;
  const totalSettledAmount = settlements
    .filter((s) => s.status === "settled")
    .reduce((sum, s) => sum + s.netAmount, 0);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Settlements</h2>
          <p className="text-muted text-sm mt-1">
            Calculate, approve, and process merchant payouts
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors"
        >
          {showForm ? "Cancel" : "Generate Settlement"}
        </button>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-sm text-danger flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-xs underline hover:no-underline">Dismiss</button>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-card-border rounded-xl p-5">
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Pending Approval</p>
          <p className="text-2xl font-bold text-warning">{pendingCount}</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-5">
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Settled</p>
          <p className="text-2xl font-bold text-success">{settledCount}</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-5">
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Total Paid Out</p>
          <p className="text-2xl font-bold text-accent">{formatCents(totalSettledAmount)}</p>
        </div>
      </div>

      {/* Generate form */}
      {showForm && (
        <form onSubmit={handleGenerate} className="bg-card border border-card-border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold">Generate New Settlement</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-muted mb-1">Merchant Account ID</label>
              <input
                type="text"
                value={formMerchantId}
                onChange={(e) => setFormMerchantId(e.target.value)}
                required
                placeholder="merch_..."
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Period Start</label>
              <input
                type="date"
                value={formStart}
                onChange={(e) => setFormStart(e.target.value)}
                required
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Period End</label>
              <input
                type="date"
                value={formEnd}
                onChange={(e) => setFormEnd(e.target.value)}
                required
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={generating}
            className="px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-50"
          >
            {generating ? "Calculating..." : "Calculate Settlement"}
          </button>
        </form>
      )}

      {/* Settlement detail view */}
      {selected && (
        <div className="bg-card border border-card-border rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <button
                onClick={() => { setSelected(null); setReport(null); }}
                className="text-sm text-accent hover:underline mb-2 block"
              >
                &larr; Back to list
              </button>
              <h3 className="font-semibold text-lg">Settlement Detail</h3>
              <p className="text-xs font-mono text-muted">{selected.id}</p>
            </div>
            <SettlementStatusBadge status={selected.status} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
            <div>
              <p className="text-xs text-muted uppercase tracking-wider mb-1">Period</p>
              <p className="text-sm">{formatDate(selected.periodStart)} — {formatDate(selected.periodEnd)}</p>
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wider mb-1">Gross</p>
              <p className="text-sm font-mono">{formatCents(selected.grossAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wider mb-1">Fees</p>
              <p className="text-sm font-mono text-warning">{formatCents(selected.totalFees)}</p>
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wider mb-1">Net Payout</p>
              <p className="text-sm font-mono font-bold text-success">{formatCents(selected.netAmount)}</p>
            </div>
          </div>

          {selected.totalRefunds > 0 && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted uppercase tracking-wider mb-1">Refunds</p>
                <p className="text-sm font-mono text-danger">{formatCents(selected.totalRefunds)}</p>
              </div>
              <div>
                <p className="text-xs text-muted uppercase tracking-wider mb-1">Chargebacks</p>
                <p className="text-sm font-mono text-danger">{formatCents(selected.totalChargebacks)}</p>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            {selected.status === "pending_approval" && (
              <button
                onClick={() => handleApprove(selected.id)}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-50"
              >
                {actionLoading ? "Approving..." : "Approve Settlement"}
              </button>
            )}
            {selected.status === "approved" && (
              <button
                onClick={() => handleProcess(selected.id)}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg bg-success text-white text-sm font-medium hover:bg-success/80 transition-colors disabled:opacity-50"
              >
                {actionLoading ? "Processing..." : "Process Payout"}
              </button>
            )}
            <a
              href={getSettlementExportUrl(selected.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg bg-card border border-card-border text-sm text-muted hover:text-foreground transition-colors"
            >
              Export CSV
            </a>
          </div>

          {/* Report line items */}
          {reportLoading ? (
            <div className="text-sm text-muted animate-pulse py-4">Loading report...</div>
          ) : report && report.lineItems.length > 0 ? (
            <div className="overflow-x-auto border border-card-border rounded-lg mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-card-border">
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Payment ID</th>
                    <th className="px-4 py-2 font-medium text-right">Amount</th>
                    <th className="px-4 py-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {report.lineItems.map((item, i) => (
                    <tr key={i} className="border-t border-card-border/50">
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          item.type === "capture" ? "bg-success/15 text-success"
                          : item.type === "refund" ? "bg-danger/15 text-danger"
                          : item.type === "fee" ? "bg-warning/15 text-warning"
                          : "bg-muted/15 text-muted"
                        }`}>
                          {item.type}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted">
                        {item.paymentId.length > 20
                          ? `${item.paymentId.slice(0, 8)}...${item.paymentId.slice(-4)}`
                          : item.paymentId}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {formatCents(item.amount)}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted">
                        {new Date(item.effectiveAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}

      {/* Settlement list */}
      {!selected && (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="p-5 border-b border-card-border">
            <h3 className="font-semibold">All Settlements</h3>
            <p className="text-xs text-muted mt-0.5">
              {loading ? "Loading..." : `${total} settlement${total !== 1 ? "s" : ""}`}
            </p>
          </div>
          {loading ? (
            <div className="p-8 text-center text-muted text-sm animate-pulse">Loading settlements...</div>
          ) : settlements.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm">
              No settlements yet. Generate one using the button above.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-card-border">
                    <th className="px-5 py-3 font-medium">Period</th>
                    <th className="px-5 py-3 font-medium">Merchant</th>
                    <th className="px-5 py-3 font-medium text-right">Gross</th>
                    <th className="px-5 py-3 font-medium text-right">Fees</th>
                    <th className="px-5 py-3 font-medium text-right">Net</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => handleSelectSettlement(s)}
                      className="border-t border-card-border/50 hover:bg-card-border/20 transition-colors cursor-pointer"
                    >
                      <td className="px-5 py-3 text-xs">
                        {formatDate(s.periodStart)} — {formatDate(s.periodEnd)}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-muted">
                        {s.merchantAccountId.length > 12
                          ? `${s.merchantAccountId.slice(0, 8)}...`
                          : s.merchantAccountId}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs">{formatCents(s.grossAmount)}</td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-warning">{formatCents(s.totalFees)}</td>
                      <td className="px-5 py-3 text-right font-mono text-xs font-bold text-success">{formatCents(s.netAmount)}</td>
                      <td className="px-5 py-3">
                        <SettlementStatusBadge status={s.status} />
                      </td>
                      <td className="px-5 py-3 text-xs text-muted">
                        {new Date(s.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SettlementStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-muted/15 text-muted border-muted/30";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${style}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

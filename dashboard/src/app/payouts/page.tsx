"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchPayouts,
  fetchPayout,
  schedulePayout,
  processPayout,
  cancelPayout,
  fetchPayoutAccounts,
  type PayoutRecord,
  type PayoutAccountRecord,
} from "@/lib/api";

const STATUS_TABS = ["all", "pending", "processing", "in_transit", "paid", "failed", "canceled"] as const;

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  processing: "bg-accent/15 text-accent",
  in_transit: "bg-blue-400/15 text-blue-400",
  paid: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
  canceled: "bg-muted/15 text-muted",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  in_transit: "In Transit",
  paid: "Paid",
  failed: "Failed",
  canceled: "Canceled",
};

function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function PayoutsPage() {
  const [payouts, setPayouts] = useState<PayoutRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedPayout, setSelectedPayout] = useState<PayoutRecord | null>(null);
  const [accounts, setAccounts] = useState<PayoutAccountRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_TABS)[number]>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Schedule payout form
  const [showForm, setShowForm] = useState(false);
  const [formMerchant, setFormMerchant] = useState("default");
  const [formAmount, setFormAmount] = useState("500.00");
  const [formAccountId, setFormAccountId] = useState("");

  const loadPayouts = useCallback(async () => {
    try {
      const filters: { status?: string } = {};
      if (statusFilter !== "all") filters.status = statusFilter;
      const data = await fetchPayouts(filters);
      setPayouts(data.payouts);
      setTotal(data.total);
    } catch {
      setError("Failed to load payouts");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await fetchPayoutAccounts();
      setAccounts(data);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => { loadPayouts(); }, [loadPayouts]);
  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const handleSchedule = async () => {
    setError("");
    try {
      const amount = Math.round(parseFloat(formAmount) * 100);
      await schedulePayout({
        merchantAccountId: formMerchant,
        amount,
        payoutAccountId: formAccountId || undefined,
      });
      setShowForm(false);
      await loadPayouts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to schedule payout");
    }
  };

  const handleProcess = async (id: string) => {
    setError("");
    try {
      const updated = await processPayout(id);
      setSelectedPayout(updated);
      await loadPayouts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to process payout");
    }
  };

  const handleCancel = async (id: string) => {
    setError("");
    try {
      const updated = await cancelPayout(id);
      setSelectedPayout(updated);
      await loadPayouts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel payout");
    }
  };

  const handleSelect = async (id: string) => {
    try {
      const detail = await fetchPayout(id);
      setSelectedPayout(detail);
    } catch {
      setError("Failed to load payout details");
    }
  };

  // Summary stats
  const pendingAmount = payouts.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0);
  const inTransitAmount = payouts.filter((p) => p.status === "in_transit").reduce((s, p) => s + p.amount, 0);
  const paidAmount = payouts.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Payouts</h2>
          <p className="text-sm text-muted mt-1">Manage merchant payouts and disbursements</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent/90 transition-colors"
        >
          Schedule Payout
        </button>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card border border-card-border rounded-lg p-4">
          <p className="text-xs text-muted uppercase tracking-wider">Total Payouts</p>
          <p className="text-2xl font-bold mt-1">{total}</p>
        </div>
        <div className="bg-card border border-card-border rounded-lg p-4">
          <p className="text-xs text-muted uppercase tracking-wider">Pending</p>
          <p className="text-2xl font-bold mt-1 text-warning">{formatCents(pendingAmount)}</p>
        </div>
        <div className="bg-card border border-card-border rounded-lg p-4">
          <p className="text-xs text-muted uppercase tracking-wider">In Transit</p>
          <p className="text-2xl font-bold mt-1 text-blue-400">{formatCents(inTransitAmount)}</p>
        </div>
        <div className="bg-card border border-card-border rounded-lg p-4">
          <p className="text-xs text-muted uppercase tracking-wider">Paid</p>
          <p className="text-2xl font-bold mt-1 text-success">{formatCents(paidAmount)}</p>
        </div>
      </div>

      {/* Schedule Payout Form */}
      {showForm && (
        <div className="bg-card border border-card-border rounded-lg p-6">
          <h3 className="text-sm font-semibold mb-4">Schedule New Payout</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-muted mb-1">Merchant Account ID</label>
              <input
                value={formMerchant}
                onChange={(e) => setFormMerchant(e.target.value)}
                className="w-full bg-background border border-card-border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Amount</label>
              <input
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                type="number"
                step="0.01"
                className="w-full bg-background border border-card-border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Payout Account</label>
              <select
                value={formAccountId}
                onChange={(e) => setFormAccountId(e.target.value)}
                className="w-full bg-background border border-card-border rounded px-3 py-2 text-sm"
              >
                <option value="">Default account</option>
                {accounts.filter((a) => a.status === "verified").map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.bankName} (****{a.accountNumberMasked.slice(-4)})
                    {a.isDefault ? " [default]" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleSchedule}
              className="px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accent/90"
            >
              Schedule
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-card-border text-sm rounded hover:bg-card-border/70"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Status Filter Tabs */}
      <div className="flex gap-1 bg-card border border-card-border rounded-lg p-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setStatusFilter(tab)}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              statusFilter === tab
                ? "bg-accent text-white"
                : "text-muted hover:text-foreground hover:bg-card-border/50"
            }`}
          >
            {tab === "all" ? "All" : STATUS_LABELS[tab] ?? tab}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-muted py-12 animate-pulse">Loading payouts...</div>
      ) : (
        <div className="grid grid-cols-3 gap-6">
          {/* Payout List */}
          <div className="col-span-2 space-y-2">
            {payouts.length === 0 ? (
              <div className="bg-card border border-card-border rounded-lg p-8 text-center text-muted">
                No payouts found
              </div>
            ) : (
              payouts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelect(p.id)}
                  className={`w-full text-left bg-card border rounded-lg p-4 hover:bg-card-border/30 transition-colors ${
                    selectedPayout?.id === p.id ? "border-accent" : "border-card-border"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLES[p.status] ?? "bg-muted/15 text-muted"}`}>
                        {STATUS_LABELS[p.status] ?? p.status}
                      </span>
                      <span className="text-sm font-semibold">{formatCents(p.amount, p.currency)}</span>
                    </div>
                    <span className="text-xs text-muted">{timeAgo(p.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted">
                    <span>Merchant: {p.merchantAccountId}</span>
                    {p.fees > 0 && <span>Fees: {formatCents(p.fees)}</span>}
                    {p.failureReason && <span className="text-danger">Failed: {p.failureReason}</span>}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Detail Panel */}
          <div className="col-span-1">
            {selectedPayout ? (
              <div className="bg-card border border-card-border rounded-lg p-5 sticky top-8 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Payout Detail</h3>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLES[selectedPayout.status] ?? ""}`}>
                    {STATUS_LABELS[selectedPayout.status] ?? selectedPayout.status}
                  </span>
                </div>

                <div className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-xs text-muted">Amount</p>
                      <p className="font-semibold">{formatCents(selectedPayout.amount, selectedPayout.currency)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Fees</p>
                      <p>{formatCents(selectedPayout.fees)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Merchant</p>
                      <p className="font-mono text-xs">{selectedPayout.merchantAccountId}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Account</p>
                      <p className="font-mono text-xs truncate">{selectedPayout.payoutAccountId}</p>
                    </div>
                  </div>

                  {/* Timeline */}
                  <div className="border-t border-card-border pt-3">
                    <p className="text-xs text-muted mb-2">Timeline</p>
                    <div className="space-y-2">
                      <TimelineEntry label="Scheduled" date={selectedPayout.scheduledAt} />
                      <TimelineEntry label="Initiated" date={selectedPayout.initiatedAt} />
                      <TimelineEntry label="Arrived" date={selectedPayout.arrivedAt} />
                      {selectedPayout.failedAt && (
                        <TimelineEntry label="Failed" date={selectedPayout.failedAt} danger />
                      )}
                    </div>
                  </div>

                  {selectedPayout.settlementIds.length > 0 && (
                    <div className="border-t border-card-border pt-3">
                      <p className="text-xs text-muted mb-1">Linked Settlements</p>
                      {selectedPayout.settlementIds.map((sid) => (
                        <p key={sid} className="text-xs font-mono">{sid}</p>
                      ))}
                    </div>
                  )}

                  {selectedPayout.ledgerTransactionId && (
                    <div className="border-t border-card-border pt-3">
                      <p className="text-xs text-muted mb-1">Ledger Transaction</p>
                      <p className="text-xs font-mono">{selectedPayout.ledgerTransactionId}</p>
                    </div>
                  )}

                  {selectedPayout.failureReason && (
                    <div className="border-t border-card-border pt-3">
                      <p className="text-xs text-danger">Failure: {selectedPayout.failureReason}</p>
                      <p className="text-xs text-muted mt-1">Retries: {selectedPayout.retryCount}</p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2 border-t border-card-border">
                  {selectedPayout.status === "pending" && (
                    <>
                      <button
                        onClick={() => handleProcess(selectedPayout.id)}
                        className="flex-1 px-3 py-2 bg-accent text-white text-xs rounded hover:bg-accent/90"
                      >
                        Process
                      </button>
                      <button
                        onClick={() => handleCancel(selectedPayout.id)}
                        className="flex-1 px-3 py-2 bg-danger/10 text-danger text-xs rounded hover:bg-danger/20"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-card border border-card-border rounded-lg p-8 text-center text-muted text-sm">
                Select a payout to view details
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineEntry({ label, date, danger }: { label: string; date: string | null; danger?: boolean }) {
  if (!date) return null;
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${danger ? "bg-danger" : "bg-accent"}`} />
      <span className={`text-xs ${danger ? "text-danger" : ""}`}>{label}</span>
      <span className="text-xs text-muted ml-auto">{new Date(date).toLocaleString()}</span>
    </div>
  );
}

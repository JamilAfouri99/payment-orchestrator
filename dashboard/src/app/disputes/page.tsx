"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchDisputes,
  fetchDispute,
  createDispute,
  submitDisputeEvidence,
  resolveDispute,
  acceptDispute,
  fetchChargebackRate,
  type DisputeRecord,
  type ChargebackRateRecord,
  type EvidenceInput,
} from "@/lib/api";

const STATUS_TABS = ["all", "needs_response", "under_review", "won", "lost", "accepted"] as const;

const STATUS_STYLES: Record<string, string> = {
  needs_response: "bg-warning/15 text-warning",
  under_review: "bg-accent/15 text-accent",
  won: "bg-success/15 text-success",
  lost: "bg-danger/15 text-danger",
  accepted: "bg-muted/15 text-muted",
};

const REASON_LABELS: Record<string, string> = {
  fraudulent: "Fraudulent",
  product_not_received: "Not Received",
  product_unacceptable: "Unacceptable",
  duplicate: "Duplicate",
  subscription_canceled: "Sub Canceled",
  credit_not_processed: "Credit Not Processed",
  general: "General",
};

const TYPE_LABELS: Record<string, string> = {
  chargeback: "Chargeback",
  inquiry: "Inquiry",
  retrieval: "Retrieval",
  pre_arbitration: "Pre-Arbitration",
};

const THRESHOLD_STYLES: Record<string, { color: string; label: string }> = {
  normal: { color: "text-success", label: "Normal" },
  warning: { color: "text-warning", label: "Warning" },
  excessive: { color: "text-orange-400", label: "Excessive" },
  critical: { color: "text-danger", label: "Critical" },
};

export default function DisputesPage() {
  const [disputes, setDisputes] = useState<DisputeRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<DisputeRecord | null>(null);
  const [cbRate, setCbRate] = useState<ChargebackRateRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create dispute form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    paymentId: "",
    reason: "fraudulent",
    amount: "",
    type: "chargeback",
  });
  const [creating, setCreating] = useState(false);

  // Evidence form
  const [showEvidence, setShowEvidence] = useState(false);
  const [evidenceForm, setEvidenceForm] = useState<EvidenceInput>({
    type: "receipt",
    description: "",
    content: "",
  });
  const [submittingEvidence, setSubmittingEvidence] = useState(false);

  const loadDisputes = useCallback(async () => {
    try {
      setLoading(true);
      const filters: { status?: string } = {};
      if (tab !== "all") filters.status = tab;
      const data = await fetchDisputes(filters);
      setDisputes(data.disputes);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load disputes");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  const loadChargebackRate = useCallback(async () => {
    try {
      const rate = await fetchChargebackRate();
      setCbRate(rate);
    } catch {
      // Non-critical
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const dispute = await fetchDispute(id);
      setSelected(dispute);
    } catch {
      setSelected(null);
    }
  }, []);

  useEffect(() => {
    loadDisputes();
    loadChargebackRate();
  }, [loadDisputes, loadChargebackRate]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      await createDispute({
        paymentId: createForm.paymentId || `pay_test_${Date.now()}`,
        reason: createForm.reason,
        amount: parseInt(createForm.amount, 10) || 5000,
        type: createForm.type,
      });
      setShowCreate(false);
      setCreateForm({ paymentId: "", reason: "fraudulent", amount: "", type: "chargeback" });
      await loadDisputes();
      await loadChargebackRate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create dispute");
    } finally {
      setCreating(false);
    }
  }

  async function handleSubmitEvidence() {
    if (!selectedId) return;
    setSubmittingEvidence(true);
    setError(null);
    try {
      const updated = await submitDisputeEvidence(selectedId, [evidenceForm]);
      setSelected(updated);
      setShowEvidence(false);
      setEvidenceForm({ type: "receipt", description: "", content: "" });
      await loadDisputes();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit evidence");
    } finally {
      setSubmittingEvidence(false);
    }
  }

  async function handleResolve(outcome: "won" | "lost") {
    if (!selectedId) return;
    setError(null);
    try {
      const updated = await resolveDispute(selectedId, outcome);
      setSelected(updated);
      await loadDisputes();
      await loadChargebackRate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to resolve dispute");
    }
  }

  async function handleAccept() {
    if (!selectedId) return;
    setError(null);
    try {
      const updated = await acceptDispute(selectedId);
      setSelected(updated);
      await loadDisputes();
      await loadChargebackRate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to accept dispute");
    }
  }

  function daysUntilDeadline(evidenceDueBy: string): number {
    const due = new Date(evidenceDueBy);
    const now = new Date();
    return Math.ceil((due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  }

  const needsResponseCount = disputes.filter((d) => d.status === "needs_response").length;
  const wonCount = disputes.filter((d) => d.status === "won").length;
  const lostCount = disputes.filter((d) => d.status === "lost" || d.status === "accepted").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Disputes</h2>
          <p className="text-muted text-sm mt-1">Chargeback and dispute lifecycle management</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm font-medium hover:bg-danger/20 transition-colors"
        >
          Create Test Dispute
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-card border border-card-border rounded-xl p-5">
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Total Disputes</p>
          <p className="text-2xl font-bold">{total}</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-5">
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Needs Response</p>
          <p className="text-2xl font-bold text-warning">{needsResponseCount}</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-5">
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Won</p>
          <p className="text-2xl font-bold text-success">{wonCount}</p>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-5">
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Lost / Accepted</p>
          <p className="text-2xl font-bold text-danger">{lostCount}</p>
        </div>
        <ChargebackRateCard rate={cbRate} />
      </div>

      {/* Create Dispute Modal */}
      {showCreate && (
        <div className="bg-card border border-card-border rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">Simulate Dispute (PSP Notification)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted mb-1 block">Payment ID</label>
              <input
                value={createForm.paymentId}
                onChange={(e) => setCreateForm({ ...createForm, paymentId: e.target.value })}
                placeholder="pay_test_123 (auto-generated if blank)"
                className="w-full px-3 py-2 rounded-lg bg-background border border-card-border text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Amount (cents)</label>
              <input
                value={createForm.amount}
                onChange={(e) => setCreateForm({ ...createForm, amount: e.target.value })}
                placeholder="5000"
                type="number"
                className="w-full px-3 py-2 rounded-lg bg-background border border-card-border text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Reason</label>
              <select
                value={createForm.reason}
                onChange={(e) => setCreateForm({ ...createForm, reason: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-background border border-card-border text-sm"
              >
                {Object.entries(REASON_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Type</label>
              <select
                value={createForm.type}
                onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-background border border-card-border text-sm"
              >
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-4 py-2 rounded-lg bg-danger text-white text-sm font-medium hover:bg-danger/80 transition-colors disabled:opacity-50"
            >
              {creating ? "Creating..." : "File Dispute"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-lg bg-card-border/50 text-sm hover:bg-card-border transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Status Tabs */}
      <div className="flex gap-1 bg-card border border-card-border rounded-lg p-1">
        {STATUS_TABS.map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setSelectedId(null); setSelected(null); }}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              tab === t ? "bg-accent/15 text-accent font-medium" : "text-muted hover:text-foreground"
            }`}
          >
            {t === "all" ? "All" : t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Two-pane layout: list + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Dispute List */}
        <div className="lg:col-span-2 space-y-2">
          {loading && <p className="text-muted text-sm animate-pulse">Loading...</p>}
          {!loading && disputes.length === 0 && (
            <p className="text-muted text-sm py-8 text-center">No disputes found</p>
          )}
          {disputes.map((d) => {
            const days = daysUntilDeadline(d.evidenceDueBy);
            const isUrgent = d.status === "needs_response" && days <= 3 && days >= 0;
            const isPast = d.status === "needs_response" && days < 0;
            return (
              <button
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className={`w-full text-left p-4 rounded-lg border transition-colors ${
                  selectedId === d.id
                    ? "bg-accent/5 border-accent/30"
                    : "bg-card border-card-border hover:border-accent/20"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLES[d.status] ?? "bg-muted/15 text-muted"}`}>
                      {d.status.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-muted">{TYPE_LABELS[d.type] ?? d.type}</span>
                  </div>
                  <span className="font-semibold text-sm">
                    ${(d.amount / 100).toFixed(2)} {d.currency}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-xs text-muted">
                    <span>{REASON_LABELS[d.reason] ?? d.reason}</span>
                    <span className="font-mono">{d.paymentId.slice(0, 12)}...</span>
                    <span>Code: {d.networkReasonCode}</span>
                  </div>
                  {d.status === "needs_response" && (
                    <span className={`text-xs font-medium ${isPast ? "text-danger" : isUrgent ? "text-warning" : "text-muted"}`}>
                      {isPast ? "Deadline passed" : `${days}d left`}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-1">
          {selected ? (
            <div className="bg-card border border-card-border rounded-xl p-5 space-y-4 sticky top-8">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">Dispute Detail</h3>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLES[selected.status] ?? ""}`}>
                    {selected.status.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-xs text-muted font-mono">{selected.id}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted">Amount</p>
                  <p className="font-semibold">${(selected.amount / 100).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Type</p>
                  <p>{TYPE_LABELS[selected.type] ?? selected.type}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Reason</p>
                  <p>{REASON_LABELS[selected.reason] ?? selected.reason}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Network Code</p>
                  <p className="font-mono">{selected.networkReasonCode}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Filed</p>
                  <p>{new Date(selected.filedAt).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Evidence Due</p>
                  <p className={daysUntilDeadline(selected.evidenceDueBy) < 0 ? "text-danger" : ""}>
                    {new Date(selected.evidenceDueBy).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted">External ID</p>
                  <p className="font-mono text-xs">{selected.externalDisputeId}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Payment</p>
                  <p className="font-mono text-xs">{selected.paymentId.slice(0, 12)}...</p>
                </div>
                {selected.outcome && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted">Outcome</p>
                    <p className={`font-semibold ${selected.outcome === "won" ? "text-success" : "text-danger"}`}>
                      {selected.outcome.toUpperCase()}
                    </p>
                  </div>
                )}
              </div>

              {/* Evidence List */}
              {selected.evidence.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Evidence ({selected.evidence.length})</h4>
                  <div className="space-y-2">
                    {selected.evidence.map((ev) => (
                      <div key={ev.id} className="p-2 rounded bg-background/50 border border-card-border/50 text-xs">
                        <div className="flex justify-between mb-1">
                          <span className="font-medium">{ev.type.replace(/_/g, " ")}</span>
                          <span className="text-muted">{new Date(ev.submittedAt).toLocaleString()}</span>
                        </div>
                        <p className="text-muted">{ev.description}</p>
                        {ev.content && <p className="font-mono mt-1 text-muted/70 truncate">{ev.content}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              {selected.status === "needs_response" && (
                <div className="space-y-3 pt-2 border-t border-card-border">
                  {!showEvidence ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowEvidence(true)}
                        className="flex-1 px-3 py-2 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 transition-colors"
                      >
                        Submit Evidence
                      </button>
                      <button
                        onClick={handleAccept}
                        className="flex-1 px-3 py-2 rounded-lg bg-muted/10 border border-muted/30 text-muted text-sm font-medium hover:bg-muted/20 transition-colors"
                      >
                        Accept (Lose)
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-muted mb-1 block">Evidence Type</label>
                        <select
                          value={evidenceForm.type}
                          onChange={(e) => setEvidenceForm({ ...evidenceForm, type: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg bg-background border border-card-border text-sm"
                        >
                          <option value="receipt">Receipt</option>
                          <option value="shipping_proof">Shipping Proof</option>
                          <option value="customer_communication">Customer Communication</option>
                          <option value="refund_policy">Refund Policy</option>
                          <option value="service_documentation">Service Documentation</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted mb-1 block">Description</label>
                        <input
                          value={evidenceForm.description}
                          onChange={(e) => setEvidenceForm({ ...evidenceForm, description: e.target.value })}
                          placeholder="Describe the evidence"
                          className="w-full px-3 py-2 rounded-lg bg-background border border-card-border text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted mb-1 block">Content</label>
                        <textarea
                          value={evidenceForm.content}
                          onChange={(e) => setEvidenceForm({ ...evidenceForm, content: e.target.value })}
                          placeholder="Evidence content (text, URL, tracking number, etc.)"
                          rows={3}
                          className="w-full px-3 py-2 rounded-lg bg-background border border-card-border text-sm resize-none"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleSubmitEvidence}
                          disabled={submittingEvidence || !evidenceForm.description}
                          className="flex-1 px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-50"
                        >
                          {submittingEvidence ? "Submitting..." : "Submit"}
                        </button>
                        <button
                          onClick={() => setShowEvidence(false)}
                          className="px-3 py-2 rounded-lg bg-card-border/50 text-sm hover:bg-card-border transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {selected.status === "under_review" && (
                <div className="space-y-2 pt-2 border-t border-card-border">
                  <p className="text-xs text-muted">Simulate network resolution:</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleResolve("won")}
                      className="flex-1 px-3 py-2 rounded-lg bg-success/10 border border-success/30 text-success text-sm font-medium hover:bg-success/20 transition-colors"
                    >
                      Won
                    </button>
                    <button
                      onClick={() => handleResolve("lost")}
                      className="flex-1 px-3 py-2 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm font-medium hover:bg-danger/20 transition-colors"
                    >
                      Lost
                    </button>
                  </div>
                </div>
              )}

              {(selected.status === "won" || selected.status === "lost" || selected.status === "accepted") && (
                <div className="pt-2 border-t border-card-border">
                  <p className={`text-sm font-semibold ${selected.outcome === "won" ? "text-success" : "text-danger"}`}>
                    Resolved: {selected.outcome?.toUpperCase() ?? selected.status.toUpperCase()}
                  </p>
                  {selected.resolvedAt && (
                    <p className="text-xs text-muted">
                      {new Date(selected.resolvedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-card border border-card-border rounded-xl p-8 text-center">
              <p className="text-muted text-sm">Select a dispute to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChargebackRateCard({ rate }: { rate: ChargebackRateRecord | null }) {
  if (!rate) {
    return (
      <div className="bg-card border border-card-border rounded-xl p-5">
        <p className="text-xs text-muted uppercase tracking-wider mb-1">Chargeback Rate</p>
        <p className="text-2xl font-bold text-muted animate-pulse">...</p>
      </div>
    );
  }

  const style = THRESHOLD_STYLES[rate.threshold] ?? THRESHOLD_STYLES.normal!;
  const pct = Math.min(rate.rate * 100, 2);
  const angle = (pct / 2) * 180;

  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <p className="text-xs text-muted uppercase tracking-wider mb-1">Chargeback Rate</p>
      <div className="flex items-center gap-3">
        {/* Mini gauge */}
        <svg width="40" height="24" viewBox="0 0 40 24">
          <path d="M 4 22 A 16 16 0 0 1 36 22" fill="none" stroke="currentColor" className="text-card-border" strokeWidth="3" strokeLinecap="round" />
          <path
            d="M 4 22 A 16 16 0 0 1 36 22"
            fill="none"
            stroke="currentColor"
            className={style.color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(angle / 180) * 50.3} 50.3`}
          />
        </svg>
        <div>
          <p className={`text-lg font-bold ${style.color}`}>{rate.ratePercent}</p>
          <p className={`text-xs font-medium ${style.color}`}>{style.label}</p>
        </div>
      </div>
      <p className="text-xs text-muted mt-1">
        {rate.disputeCount} / {rate.transactionCount} in {rate.windowDays}d
      </p>
      {rate.blocked && (
        <p className="text-xs text-danger font-medium mt-1">Payments blocked</p>
      )}
    </div>
  );
}

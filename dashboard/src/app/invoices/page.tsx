"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchInvoices,
  payInvoice,
  voidInvoice,
  processBillingCycle,
  type InvoiceRecord,
  type BillingCycleResultRecord,
} from "@/lib/api";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_TABS = ["all", "draft", "open", "paid", "past_due", "void", "uncollectible"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const STATUS_LABEL: Record<StatusTab, string> = {
  all: "All",
  draft: "Draft",
  open: "Open",
  paid: "Paid",
  past_due: "Past Due",
  void: "Void",
  uncollectible: "Uncollectible",
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

function isCurrentMonth(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: "bg-muted/15 text-muted",
    open: "bg-accent/15 text-accent",
    paid: "bg-success/15 text-success",
    past_due: "bg-danger/15 text-danger",
    void: "bg-muted/15 text-muted line-through",
    uncollectible: "bg-danger/15 text-danger",
  };
  const cls = styles[status] ?? "bg-muted/15 text-muted";
  const label = STATUS_LABEL[status as StatusTab] ?? status;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "warning" | "success" | "danger" | "muted";
}) {
  const accentClass: Record<string, string> = {
    warning: "text-warning",
    success: "text-success",
    danger: "text-danger",
    muted: "text-muted",
  };
  return (
    <div className="bg-card border border-card-border rounded-xl p-5 flex flex-col gap-1">
      <span className="text-xs text-muted uppercase tracking-wider">{label}</span>
      <span className={`text-2xl font-bold font-mono ${accentClass[accent]}`}>{value}</span>
    </div>
  );
}

interface BillingResultAlertProps {
  result: BillingCycleResultRecord;
  onDismiss: () => void;
}

function BillingResultAlert({ result, onDismiss }: BillingResultAlertProps) {
  return (
    <div className="bg-success/10 border border-success/30 rounded-lg p-4 flex items-start justify-between gap-4">
      <div className="text-sm text-success space-y-0.5">
        <p className="font-semibold">Billing cycle complete</p>
        <p className="text-foreground/80">
          Processed <strong>{result.processed}</strong> subscriptions &mdash; generated{" "}
          <strong>{result.invoicesGenerated}</strong> invoice{result.invoicesGenerated !== 1 ? "s" : ""},{" "}
          <strong>{result.paymentSuccesses}</strong> succeeded,{" "}
          <strong>{result.paymentFailures}</strong> failed.
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="text-muted hover:text-foreground transition-colors text-lg leading-none flex-shrink-0"
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}

interface LineItemsTableProps {
  items: InvoiceRecord["lineItems"];
}

function LineItemsTable({ items }: LineItemsTableProps) {
  if (items.length === 0) {
    return <p className="text-sm text-muted italic">No line items.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted uppercase tracking-wider border-b border-card-border">
          <th className="pb-2">Description</th>
          <th className="pb-2 text-right">Qty</th>
          <th className="pb-2 text-right">Unit Price</th>
          <th className="pb-2 text-right">Amount</th>
          <th className="pb-2">Period</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={i} className="border-b border-card-border/40 last:border-0">
            <td className="py-2 pr-4">{item.description}</td>
            <td className="py-2 text-right font-mono">{item.quantity}</td>
            <td className="py-2 text-right font-mono">{formatCents(item.unitAmount)}</td>
            <td className="py-2 text-right font-mono">{formatCents(item.amount)}</td>
            <td className="py-2 text-muted text-xs">
              {formatDate(item.periodStart)} – {formatDate(item.periodEnd)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface InvoiceDetailProps {
  invoice: InvoiceRecord;
  onPay: (id: string) => Promise<void>;
  onVoid: (id: string) => Promise<void>;
  actionLoading: string | null;
  actionError: string | null;
}

function InvoiceDetail({ invoice, onPay, onVoid, actionLoading, actionError }: InvoiceDetailProps) {
  const canPay = invoice.status === "open" || invoice.status === "past_due";
  const canVoid = invoice.status !== "paid" && invoice.status !== "void";
  const isPaying = actionLoading === `pay-${invoice.id}`;
  const isVoiding = actionLoading === `void-${invoice.id}`;

  return (
    <div className="bg-background border-t border-card-border p-5 space-y-5">
      {actionError && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm text-danger">
          {actionError}
        </div>
      )}

      {/* Summary fields */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Invoice ID</p>
          <p className="font-mono text-xs break-all">{invoice.id}</p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Subscription</p>
          <p className="font-mono text-xs break-all">{invoice.subscriptionId}</p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Customer</p>
          <p className="font-mono text-xs break-all">{invoice.customerId}</p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Currency</p>
          <p className="font-mono">{invoice.currency.toUpperCase()}</p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Subtotal</p>
          <p className="font-mono">{formatCents(invoice.subtotal)}</p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">
            Tax ({(invoice.taxRate * 100).toFixed(0)}%)
          </p>
          <p className="font-mono">{formatCents(invoice.taxAmount)}</p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Total</p>
          <p className="font-mono font-semibold">{formatCents(invoice.total)}</p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Due Date</p>
          <p>{formatDate(invoice.dueDate)}</p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Paid At</p>
          <p>{formatDate(invoice.paidAt)}</p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Payment ID</p>
          <p className="font-mono text-xs">{invoice.paymentId ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Next Attempt</p>
          <p className="text-xs">{formatDate(invoice.nextAttemptAt)}</p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Created</p>
          <p className="text-xs">{formatDate(invoice.createdAt)}</p>
        </div>
      </div>

      {/* Line items */}
      <div>
        <h4 className="text-xs text-muted uppercase tracking-wider mb-3">Line Items</h4>
        <LineItemsTable items={invoice.lineItems} />
      </div>

      {/* URLs */}
      {(invoice.hostedInvoiceUrl || invoice.pdfUrl) && (
        <div className="flex gap-3 flex-wrap">
          {invoice.hostedInvoiceUrl && (
            <a
              href={invoice.hostedInvoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent hover:text-accent-hover underline underline-offset-2 transition-colors"
            >
              View hosted invoice
            </a>
          )}
          {invoice.pdfUrl && (
            <a
              href={invoice.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent hover:text-accent-hover underline underline-offset-2 transition-colors"
            >
              Download PDF
            </a>
          )}
        </div>
      )}

      {/* Actions */}
      {(canPay || canVoid) && (
        <div className="flex gap-3 pt-1">
          {canPay && (
            <button
              onClick={() => onPay(invoice.id)}
              disabled={isPaying || isVoiding}
              className="px-4 py-2 rounded-lg bg-success/20 text-success border border-success/30 text-sm font-medium hover:bg-success/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isPaying ? "Paying…" : "Pay Invoice"}
            </button>
          )}
          {canVoid && (
            <button
              onClick={() => onVoid(invoice.id)}
              disabled={isPaying || isVoiding}
              className="px-4 py-2 rounded-lg bg-muted/10 text-muted border border-card-border text-sm font-medium hover:bg-muted/20 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isVoiding ? "Voiding…" : "Void Invoice"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<StatusTab>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [billingLoading, setBillingLoading] = useState(false);
  const [billingResult, setBillingResult] = useState<BillingCycleResultRecord | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchInvoices();
      setInvoices(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Summary calculations ──────────────────────────────────────────────────

  const outstanding = invoices
    .filter((inv) => inv.status === "open" || inv.status === "past_due")
    .reduce((sum, inv) => sum + inv.total, 0);

  const paidThisMonth = invoices
    .filter((inv) => inv.status === "paid" && inv.paidAt && isCurrentMonth(inv.paidAt))
    .reduce((sum, inv) => sum + inv.total, 0);

  const overdueCount = invoices.filter((inv) => inv.status === "past_due").length;

  // ── Filtering ────────────────────────────────────────────────────────────

  const filtered =
    activeTab === "all" ? invoices : invoices.filter((inv) => inv.status === activeTab);

  // ── Actions ──────────────────────────────────────────────────────────────

  async function handleRunBilling() {
    setBillingLoading(true);
    setBillingError(null);
    setBillingResult(null);
    try {
      const result = await processBillingCycle();
      setBillingResult(result);
      await load();
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : "Billing cycle failed");
    } finally {
      setBillingLoading(false);
    }
  }

  async function handlePay(id: string) {
    setActionLoading(`pay-${id}`);
    setActionError(null);
    try {
      const updated = await payInvoice(id);
      setInvoices((prev) => prev.map((inv) => (inv.id === id ? updated : inv)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to pay invoice");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleVoid(id: string) {
    setActionLoading(`void-${id}`);
    setActionError(null);
    try {
      const updated = await voidInvoice(id);
      setInvoices((prev) => prev.map((inv) => (inv.id === id ? updated : inv)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to void invoice");
    } finally {
      setActionLoading(null);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Invoices</h2>
        <p className="text-muted text-sm mt-1">Invoice Management &amp; Billing</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Outstanding" value={formatCents(outstanding)} accent="warning" />
        <SummaryCard label="Paid This Month" value={formatCents(paidThisMonth)} accent="success" />
        <SummaryCard label="Overdue" value={String(overdueCount)} accent="danger" />
        <SummaryCard label="Total Invoices" value={String(invoices.length)} accent="muted" />
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleRunBilling}
          disabled={billingLoading}
          className="px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {billingLoading ? "Running…" : "Run Billing Cycle"}
        </button>
        {billingError && (
          <span className="text-sm text-danger">{billingError}</span>
        )}
      </div>

      {/* Billing cycle result */}
      {billingResult && (
        <BillingResultAlert result={billingResult} onDismiss={() => setBillingResult(null)} />
      )}

      {/* Fetch error */}
      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-sm text-danger flex items-center justify-between gap-4">
          <span>{error}</span>
          <button
            onClick={load}
            className="text-xs underline underline-offset-2 hover:text-foreground transition-colors flex-shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-1 border-b border-card-border pb-0">
        {STATUS_TABS.map((tab) => {
          const count =
            tab === "all"
              ? invoices.length
              : invoices.filter((inv) => inv.status === tab).length;
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                setExpandedId(null);
              }}
              className={[
                "px-3 py-2 text-sm font-medium rounded-t transition-colors -mb-px border border-transparent",
                isActive
                  ? "text-foreground border-card-border border-b-card bg-card"
                  : "text-muted hover:text-foreground",
              ].join(" ")}
            >
              {STATUS_LABEL[tab]}
              {count > 0 && (
                <span
                  className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                    isActive ? "bg-accent/20 text-accent" : "bg-muted/15 text-muted"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Invoice table */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border text-left text-xs text-muted uppercase tracking-wider">
              <th className="px-5 py-3">Invoice ID</th>
              <th className="px-5 py-3">Subscription</th>
              <th className="px-5 py-3">Customer</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Amount</th>
              <th className="px-5 py-3">Due Date</th>
              <th className="px-5 py-3 text-right">Attempts</th>
              <th className="px-5 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-5 py-12 text-center text-muted animate-pulse">
                  Loading invoices…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-12 text-center text-muted">
                  No invoices{activeTab !== "all" ? ` with status "${STATUS_LABEL[activeTab]}"` : ""}.
                </td>
              </tr>
            ) : (
              filtered.map((inv) => {
                const isExpanded = expandedId === inv.id;
                return (
                  <>
                    <tr
                      key={inv.id}
                      onClick={() => setExpandedId(isExpanded ? null : inv.id)}
                      className="border-b border-card-border/50 hover:bg-card-border/20 transition-colors cursor-pointer select-none"
                    >
                      <td className="px-5 py-3 font-mono text-xs text-accent">
                        {inv.id.slice(0, 8)}…
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-muted">
                        {inv.subscriptionId.slice(0, 8)}…
                      </td>
                      <td className="px-5 py-3 font-mono text-xs">
                        {inv.customerId.slice(0, 8)}…
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="px-5 py-3 text-right font-mono">
                        {formatCents(inv.total)}
                      </td>
                      <td className="px-5 py-3 text-xs text-muted">
                        {formatDate(inv.dueDate)}
                      </td>
                      <td className="px-5 py-3 text-right text-muted">{inv.attemptCount}</td>
                      <td className="px-5 py-3 text-xs text-muted">
                        {formatDate(inv.createdAt)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${inv.id}-detail`}>
                        <td colSpan={8} className="p-0">
                          <InvoiceDetail
                            invoice={inv}
                            onPay={handlePay}
                            onVoid={handleVoid}
                            actionLoading={actionLoading}
                            actionError={actionError}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

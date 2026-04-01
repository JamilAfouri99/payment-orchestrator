"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchPlans,
  createPlan,
  archivePlan,
  fetchSubscriptions,
  createSubscription,
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
  fetchSubscriptionEvents,
  fetchUpcomingInvoice,
  type PlanRecord,
  type SubscriptionRecord,
  type UpcomingInvoiceRecord,
} from "@/lib/api";

// ─── Constants ────────────────────────────────────────────────────────────────

const BILLING_INTERVALS = ["daily", "weekly", "monthly", "yearly"] as const;

const STATUS_FILTERS = ["all", "trialing", "active", "past_due", "paused", "canceled"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_STYLES: Record<string, string> = {
  trialing: "bg-accent/15 text-accent",
  active: "bg-success/15 text-success",
  past_due: "bg-danger/15 text-danger",
  paused: "bg-warning/15 text-warning",
  canceled: "bg-muted/15 text-muted",
};

const INPUT_CLASS =
  "w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-muted/15 text-muted";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${style}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string | number;
  colorClass: string;
}) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <p className="text-xs text-muted uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-2xl font-bold font-mono ${colorClass}`}>{value}</p>
    </div>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-sm text-danger flex items-center justify-between">
      <span>{message}</span>
      <button onClick={onDismiss} className="text-xs underline hover:no-underline ml-4 shrink-0">
        Dismiss
      </button>
    </div>
  );
}

// ─── Plans Tab ────────────────────────────────────────────────────────────────

const EMPTY_PLAN_FORM = {
  name: "",
  billingInterval: "monthly" as string,
  amount: "",
  currency: "USD",
  trialDays: "",
  featuresRaw: "",
};

function PlansTab({
  plans,
  onPlansChange,
  onError,
}: {
  plans: PlanRecord[];
  onPlansChange: (plans: PlanRecord[]) => void;
  onError: (msg: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_PLAN_FORM);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);

  function setField(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleCreate() {
    const amountNum = parseInt(form.amount, 10);
    if (!form.name.trim()) { onError("Plan name is required"); return; }
    if (!amountNum || amountNum <= 0) { onError("Amount must be a positive integer (cents)"); return; }

    const features = form.featuresRaw
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);

    setSaving(true);
    try {
      const plan = await createPlan({
        name: form.name.trim(),
        billingInterval: form.billingInterval,
        amount: amountNum,
        currency: form.currency,
        trialDays: form.trialDays ? parseInt(form.trialDays, 10) : undefined,
        features: features.length > 0 ? features : undefined,
      });
      onPlansChange([plan, ...plans]);
      setForm(EMPTY_PLAN_FORM);
      setShowForm(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create plan");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(id: string) {
    setArchiving(id);
    try {
      await archivePlan(id);
      onPlansChange(plans.filter((p) => p.id !== id));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to archive plan");
    } finally {
      setArchiving(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{plans.length} plan{plans.length !== 1 ? "s" : ""}</p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          {showForm ? "Cancel" : "+ Create Plan"}
        </button>
      </div>

      {showForm && (
        <div className="bg-card border border-card-border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold text-sm">New Plan</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-muted mb-1.5">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="e.g. Pro Monthly"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5">Billing Interval</label>
              <select
                value={form.billingInterval}
                onChange={(e) => setField("billingInterval", e.target.value)}
                className={INPUT_CLASS}
              >
                {BILLING_INTERVALS.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5">Amount (cents) *</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setField("amount", e.target.value)}
                placeholder="e.g. 2999"
                min="1"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5">Currency</label>
              <input
                type="text"
                value={form.currency}
                onChange={(e) => setField("currency", e.target.value.toUpperCase())}
                placeholder="USD"
                maxLength={3}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5">Trial Days</label>
              <input
                type="number"
                value={form.trialDays}
                onChange={(e) => setField("trialDays", e.target.value)}
                placeholder="0"
                min="0"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5">Features (comma-separated)</label>
              <input
                type="text"
                value={form.featuresRaw}
                onChange={(e) => setField("featuresRaw", e.target.value)}
                placeholder="Unlimited users, API access, Support"
                className={INPUT_CLASS}
              />
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Creating..." : "Create Plan"}
          </button>
        </div>
      )}

      {plans.length === 0 ? (
        <div className="bg-card border border-card-border rounded-xl p-10 text-center text-muted text-sm">
          No plans yet. Create one to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              archiving={archiving === plan.id}
              onArchive={() => handleArchive(plan.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  archiving,
  onArchive,
}: {
  plan: PlanRecord;
  archiving: boolean;
  onArchive: () => void;
}) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm">{plan.name}</p>
          <p className="text-xs text-muted mt-0.5 capitalize">{plan.billingInterval}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono font-bold text-accent">
            {formatCents(plan.amount, plan.currency)}
          </p>
          <p className="text-xs text-muted">{plan.currency}</p>
        </div>
      </div>

      {plan.trialDays > 0 && (
        <p className="text-xs text-muted">
          <span className="text-success font-medium">{plan.trialDays}-day</span> trial
        </p>
      )}

      {plan.features.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {plan.features.map((f) => (
            <span
              key={f}
              className="px-2 py-0.5 bg-accent/10 text-accent text-xs rounded-full"
            >
              {f}
            </span>
          ))}
        </div>
      )}

      <button
        onClick={onArchive}
        disabled={archiving || plan.status === "archived"}
        className="mt-auto px-3 py-1.5 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs font-medium hover:bg-danger/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed self-start"
      >
        {archiving ? "Archiving..." : plan.status === "archived" ? "Archived" : "Archive"}
      </button>
    </div>
  );
}

// ─── Subscriptions Tab ────────────────────────────────────────────────────────

const EMPTY_SUB_FORM = {
  customerId: "",
  planId: "",
  paymentMethodTokenId: "",
  quantity: "1",
};

function SubscriptionsTab({
  plans,
  onError,
  onSelectSub,
}: {
  plans: PlanRecord[];
  onError: (msg: string) => void;
  onSelectSub: (sub: SubscriptionRecord) => void;
}) {
  const [subs, setSubs] = useState<SubscriptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_SUB_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (filter: StatusFilter) => {
    setLoading(true);
    try {
      const data = await fetchSubscriptions(filter === "all" ? undefined : filter);
      setSubs(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load subscriptions");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load(statusFilter);
  }, [statusFilter, load]);

  function setField(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleCreate() {
    if (!form.customerId.trim()) { onError("Customer ID is required"); return; }
    if (!form.planId) { onError("Plan is required"); return; }
    const qty = parseInt(form.quantity, 10);
    if (!qty || qty < 1) { onError("Quantity must be at least 1"); return; }

    setSaving(true);
    try {
      const sub = await createSubscription({
        customerId: form.customerId.trim(),
        planId: form.planId,
        paymentMethodTokenId: form.paymentMethodTokenId.trim() || undefined,
        quantity: qty,
      });
      setSubs((prev) => [sub, ...prev]);
      setForm(EMPTY_SUB_FORM);
      setShowForm(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create subscription");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Status filter tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
              statusFilter === s
                ? "bg-accent text-white"
                : "bg-card border border-card-border text-muted hover:text-foreground"
            }`}
          >
            {s.replace("_", " ")}
          </button>
        ))}
        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-hover transition-colors"
        >
          {showForm ? "Cancel" : "+ Create Subscription"}
        </button>
      </div>

      {showForm && (
        <div className="bg-card border border-card-border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold text-sm">New Subscription</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-muted mb-1.5">Customer ID *</label>
              <input
                type="text"
                value={form.customerId}
                onChange={(e) => setField("customerId", e.target.value)}
                placeholder="cust_..."
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5">Plan *</label>
              <select
                value={form.planId}
                onChange={(e) => setField("planId", e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">Select a plan</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatCents(p.amount, p.currency)}/{p.billingInterval}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5">Payment Method Token</label>
              <input
                type="text"
                value={form.paymentMethodTokenId}
                onChange={(e) => setField("paymentMethodTokenId", e.target.value)}
                placeholder="tok_... (optional)"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1.5">Quantity</label>
              <input
                type="number"
                value={form.quantity}
                onChange={(e) => setField("quantity", e.target.value)}
                min="1"
                className={INPUT_CLASS}
              />
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Creating..." : "Create Subscription"}
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border text-left text-xs text-muted uppercase tracking-wider">
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Customer</th>
              <th className="px-5 py-3">Plan</th>
              <th className="px-5 py-3">Period</th>
              <th className="px-5 py-3">Next Billing</th>
              <th className="px-5 py-3 text-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-muted animate-pulse">
                  Loading subscriptions...
                </td>
              </tr>
            ) : subs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-muted">
                  No subscriptions found.
                </td>
              </tr>
            ) : (
              subs.map((sub) => (
                <tr
                  key={sub.id}
                  onClick={() => onSelectSub(sub)}
                  className="border-b border-card-border/50 hover:bg-card-border/20 transition-colors cursor-pointer"
                >
                  <td className="px-5 py-3">
                    <StatusBadge status={sub.status} />
                  </td>
                  <td className="px-5 py-3 font-mono text-xs">{sub.customerId}</td>
                  <td className="px-5 py-3 font-mono text-xs">{sub.planId.slice(0, 12)}…</td>
                  <td className="px-5 py-3 text-xs text-muted">
                    {formatDate(sub.currentPeriodStart)} — {formatDate(sub.currentPeriodEnd)}
                  </td>
                  <td className="px-5 py-3 text-xs">{formatDate(sub.nextBillingDate)}</td>
                  <td className="px-5 py-3 text-right font-mono">{sub.quantity}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Subscription Detail View ─────────────────────────────────────────────────

function SubscriptionDetail({
  sub,
  plans,
  onBack,
  onSubUpdated,
  onError,
}: {
  sub: SubscriptionRecord;
  plans: PlanRecord[];
  onBack: () => void;
  onSubUpdated: (updated: SubscriptionRecord) => void;
  onError: (msg: string) => void;
}) {
  const [cancelReason, setCancelReason] = useState("");
  const [actioning, setActioning] = useState<string | null>(null);
  const [upcomingInvoice, setUpcomingInvoice] = useState<UpcomingInvoiceRecord | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const planName = plans.find((p) => p.id === sub.planId)?.name ?? sub.planId;

  useEffect(() => {
    setInvoiceLoading(true);
    fetchUpcomingInvoice(sub.id)
      .then(setUpcomingInvoice)
      .catch(() => {
        // upcoming invoice may not exist for canceled subs — silently ignore
      })
      .finally(() => setInvoiceLoading(false));

    setEventsLoading(true);
    fetchSubscriptionEvents(sub.id)
      .then(setEvents)
      .catch((err) => onError(err instanceof Error ? err.message : "Failed to load events"))
      .finally(() => setEventsLoading(false));
  }, [sub.id, onError]);

  async function handleCancel() {
    if (!cancelReason.trim()) { onError("Cancellation reason is required"); return; }
    setActioning("cancel");
    try {
      const updated = await cancelSubscription(sub.id, cancelReason.trim());
      onSubUpdated(updated);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to cancel subscription");
    } finally {
      setActioning(null);
    }
  }

  async function handlePause() {
    setActioning("pause");
    try {
      const updated = await pauseSubscription(sub.id);
      onSubUpdated(updated);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to pause subscription");
    } finally {
      setActioning(null);
    }
  }

  async function handleResume() {
    setActioning("resume");
    try {
      const updated = await resumeSubscription(sub.id);
      onSubUpdated(updated);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to resume subscription");
    } finally {
      setActioning(null);
    }
  }

  const canCancel = !["canceled"].includes(sub.status);
  const canPause = ["active", "trialing"].includes(sub.status);
  const canResume = sub.status === "paused";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-muted hover:text-foreground transition-colors text-sm"
        >
          ← Back
        </button>
        <h3 className="font-semibold">Subscription Detail</h3>
        <StatusBadge status={sub.status} />
      </div>

      {/* Info card */}
      <div className="bg-card border border-card-border rounded-xl p-6">
        <h4 className="text-xs text-muted uppercase tracking-wider mb-4">Details</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
          <InfoRow label="ID" value={sub.id} mono />
          <InfoRow label="Customer" value={sub.customerId} mono />
          <InfoRow label="Plan" value={planName} />
          <InfoRow label="Status" value={sub.status.replace("_", " ")} />
          <InfoRow label="Quantity" value={String(sub.quantity)} mono />
          <InfoRow label="Payment Token" value={sub.paymentMethodTokenId ?? "—"} mono />
          <InfoRow label="Period Start" value={formatDate(sub.currentPeriodStart)} />
          <InfoRow label="Period End" value={formatDate(sub.currentPeriodEnd)} />
          <InfoRow label="Next Billing" value={formatDate(sub.nextBillingDate)} />
          {sub.trialStart && (
            <InfoRow label="Trial Start" value={formatDate(sub.trialStart)} />
          )}
          {sub.trialEnd && (
            <InfoRow label="Trial End" value={formatDate(sub.trialEnd)} />
          )}
          {sub.canceledAt && (
            <InfoRow label="Canceled At" value={formatDate(sub.canceledAt)} />
          )}
          {sub.cancelReason && (
            <InfoRow label="Cancel Reason" value={sub.cancelReason} />
          )}
          <InfoRow label="Created" value={formatDate(sub.createdAt)} />
          <InfoRow label="Updated" value={formatDate(sub.updatedAt)} />
        </div>
      </div>

      {/* Action buttons */}
      {(canCancel || canPause || canResume) && (
        <div className="bg-card border border-card-border rounded-xl p-6 space-y-4">
          <h4 className="text-xs text-muted uppercase tracking-wider">Actions</h4>
          <div className="flex flex-wrap items-start gap-4">
            {canPause && (
              <button
                onClick={handlePause}
                disabled={actioning !== null}
                className="px-4 py-2 rounded-lg bg-warning/10 border border-warning/30 text-warning text-sm font-medium hover:bg-warning/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actioning === "pause" ? "Pausing..." : "Pause"}
              </button>
            )}
            {canResume && (
              <button
                onClick={handleResume}
                disabled={actioning !== null}
                className="px-4 py-2 rounded-lg bg-success/10 border border-success/30 text-success text-sm font-medium hover:bg-success/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actioning === "resume" ? "Resuming..." : "Resume"}
              </button>
            )}
            {canCancel && (
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Cancellation reason"
                  className="bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-danger transition-colors min-w-52"
                />
                <button
                  onClick={handleCancel}
                  disabled={actioning !== null || !cancelReason.trim()}
                  className="px-4 py-2 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm font-medium hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {actioning === "cancel" ? "Canceling..." : "Cancel Subscription"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Upcoming invoice */}
      <div className="bg-card border border-card-border rounded-xl p-6">
        <h4 className="text-xs text-muted uppercase tracking-wider mb-4">Upcoming Invoice</h4>
        {invoiceLoading ? (
          <p className="text-muted text-sm animate-pulse">Loading...</p>
        ) : upcomingInvoice ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <InfoRow label="Plan" value={upcomingInvoice.planName} />
            <InfoRow
              label="Amount"
              value={formatCents(upcomingInvoice.amount, upcomingInvoice.currency)}
              mono
            />
            <InfoRow label="Qty" value={String(upcomingInvoice.quantity)} mono />
            <InfoRow label="Due" value={formatDate(upcomingInvoice.dueDate)} />
            <InfoRow label="Period Start" value={formatDate(upcomingInvoice.periodStart)} />
            <InfoRow label="Period End" value={formatDate(upcomingInvoice.periodEnd)} />
          </div>
        ) : (
          <p className="text-muted text-sm">No upcoming invoice available.</p>
        )}
      </div>

      {/* Event timeline */}
      <div className="bg-card border border-card-border rounded-xl p-6">
        <h4 className="text-xs text-muted uppercase tracking-wider mb-4">Event Timeline</h4>
        {eventsLoading ? (
          <p className="text-muted text-sm animate-pulse">Loading events...</p>
        ) : events.length === 0 ? (
          <p className="text-muted text-sm">No events recorded.</p>
        ) : (
          <div className="space-y-0 relative before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-card-border">
            {events.map((event, idx) => (
              <EventRow key={idx} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted mb-0.5">{label}</p>
      <p className={`text-sm break-all ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function EventRow({ event }: { event: Record<string, unknown> }) {
  const type = typeof event["type"] === "string" ? event["type"] : "event";
  const occurredAt =
    typeof event["occurredAt"] === "string"
      ? event["occurredAt"]
      : typeof event["createdAt"] === "string"
      ? event["createdAt"]
      : null;

  return (
    <div className="flex gap-4 pb-4 last:pb-0 pl-6 relative">
      <div className="absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full bg-accent/20 border border-accent/50 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{type}</p>
        {occurredAt && (
          <p className="text-xs text-muted mt-0.5">
            {new Date(occurredAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SubscriptionsPage() {
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [allSubs, setAllSubs] = useState<SubscriptionRecord[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"plans" | "subscriptions">("plans");
  const [selectedSub, setSelectedSub] = useState<SubscriptionRecord | null>(null);

  const loadInitial = useCallback(async () => {
    setLoadingInitial(true);
    try {
      const [fetchedPlans, fetchedSubs] = await Promise.all([
        fetchPlans(),
        fetchSubscriptions(),
      ]);
      setPlans(fetchedPlans);
      setAllSubs(fetchedSubs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // Summary metrics derived from all subscriptions
  const activeCount = allSubs.filter((s) => s.status === "active").length;
  const trialingCount = allSubs.filter((s) => s.status === "trialing").length;
  const pastDueCount = allSubs.filter((s) => s.status === "past_due").length;

  // MRR: sum amounts of active subscriptions using plan lookup
  const planAmountById = Object.fromEntries(plans.map((p) => [p.id, p.amount]));
  const mrr = allSubs
    .filter((s) => s.status === "active")
    .reduce((sum, s) => sum + (planAmountById[s.planId] ?? 0) * s.quantity, 0);

  function handleSubUpdated(updated: SubscriptionRecord) {
    setAllSubs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setSelectedSub(updated);
  }

  if (loadingInitial) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted animate-pulse">Loading subscriptions...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Subscriptions</h2>
        <p className="text-muted text-sm mt-1">Subscription Plans &amp; Lifecycle Management</p>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Active" value={activeCount} colorClass="text-success" />
        <SummaryCard label="Trialing" value={trialingCount} colorClass="text-accent" />
        <SummaryCard label="MRR" value={formatCents(mrr)} colorClass="text-accent" />
        <SummaryCard label="Past Due" value={pastDueCount} colorClass="text-danger" />
      </div>

      {/* Tab bar */}
      <div className="border-b border-card-border">
        <div className="flex gap-0">
          {(["plans", "subscriptions"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSelectedSub(null); }}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
                activeTab === tab
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "plans" && (
        <PlansTab
          plans={plans}
          onPlansChange={setPlans}
          onError={setError}
        />
      )}

      {activeTab === "subscriptions" && (
        selectedSub ? (
          <SubscriptionDetail
            sub={selectedSub}
            plans={plans}
            onBack={() => setSelectedSub(null)}
            onSubUpdated={handleSubUpdated}
            onError={setError}
          />
        ) : (
          <SubscriptionsTab
            plans={plans}
            onError={setError}
            onSelectSub={setSelectedSub}
          />
        )
      )}
    </div>
  );
}

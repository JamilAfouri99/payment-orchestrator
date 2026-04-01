"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import {
  getPayment,
  getPaymentEvents,
  replayPayment,
  getPaymentStateAt,
  type PaymentState,
  type DomainEvent,
  type PaymentFxDetails,
} from "@/lib/api";
import { StatusBadge } from "@/components/status-badge";
import { EventTimeline } from "@/components/event-timeline";
import { SagaFlow } from "@/components/saga-flow";

export default function PaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [payment, setPayment] = useState<PaymentState | null>(null);
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [replaying, setReplaying] = useState(false);
  const [replayResult, setReplayResult] = useState<PaymentState | null>(null);

  const [temporalDate, setTemporalDate] = useState("");
  const [temporalLoading, setTemporalLoading] = useState(false);
  const [temporalResult, setTemporalResult] = useState<PaymentState | null>(null);
  const [temporalError, setTemporalError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [p, e] = await Promise.all([getPayment(id), getPaymentEvents(id)]);
        setPayment(p);
        setEvents(e);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load payment");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function handleReplay() {
    setReplaying(true);
    setReplayResult(null);
    try {
      const result = await replayPayment(id);
      setReplayResult(result);
      setPayment(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replay failed");
    } finally {
      setReplaying(false);
    }
  }

  async function handleTemporalQuery() {
    if (!temporalDate) return;
    setTemporalLoading(true);
    setTemporalError(null);
    setTemporalResult(null);
    try {
      const isoDate = new Date(temporalDate).toISOString();
      const result = await getPaymentStateAt(id, isoDate);
      setTemporalResult(result);
    } catch (err) {
      setTemporalError(err instanceof Error ? err.message : "Temporal query failed");
    } finally {
      setTemporalLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted animate-pulse">Loading payment...</div>
      </div>
    );
  }

  if (error && !payment) {
    return (
      <div className="space-y-4">
        <Link href="/payments" className="text-accent text-sm hover:text-accent-hover">&larr; Back to payments</Link>
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-6 text-danger">
          {error}
        </div>
      </div>
    );
  }

  if (!payment) return null;

  const completedEventTypes = events.map((e) => e.eventType);
  const durationMs = events.length >= 2
    ? new Date(events[events.length - 1]!.createdAt).getTime() - new Date(events[0]!.createdAt).getTime()
    : 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/payments" className="text-accent text-sm hover:text-accent-hover">&larr; Back to payments</Link>
        <h2 className="text-2xl font-bold">Payment Detail</h2>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <StatusBadge status={payment.status} />
              <span className="font-mono text-sm text-muted">{payment.id}</span>
            </div>
            <p className="text-3xl font-bold">
              ${(payment.amount / 100).toFixed(2)}{" "}
              <span className="text-lg text-muted">{payment.currency}</span>
            </p>
          </div>
          <div className="text-right text-sm text-muted space-y-1">
            <p>Customer: <span className="text-foreground">{payment.customerId}</span></p>
            <p>Order: <span className="text-foreground">{payment.orderId}</span></p>
            <p>Events: <span className="text-foreground">{events.length}</span></p>
            <p>Duration: <span className="text-foreground">{durationMs}ms</span></p>
          </div>
        </div>

        {payment.error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm text-danger mb-4">
            {payment.error}
          </div>
        )}

        <div className="border-t border-card-border pt-4">
          <h4 className="text-xs text-muted uppercase tracking-wider mb-3">Line Items</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2">Product</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2 text-right">Unit Price</th>
                <th className="pb-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {payment.items.map((item, i) => (
                <tr key={i} className="border-t border-card-border/50">
                  <td className="py-2 font-mono">{item.productId}</td>
                  <td className="py-2 text-right">{item.quantity}</td>
                  <td className="py-2 text-right">${(item.pricePerUnit / 100).toFixed(2)}</td>
                  <td className="py-2 text-right font-medium">
                    ${((item.quantity * item.pricePerUnit) / 100).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Provider / Fraud / FX / Token enrichment row */}
      {(payment.providerId || payment.fraudScore != null || payment.fxRate || payment.tokenId) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {payment.providerId && (
            <EnrichmentCard label="Provider">
              <span className="px-2.5 py-1 bg-accent/10 text-accent text-sm font-mono font-medium rounded">
                {payment.providerId}
              </span>
            </EnrichmentCard>
          )}
          {payment.fraudScore != null && (
            <EnrichmentCard label="Fraud Score">
              <div className="flex items-center gap-3">
                <FraudScoreGauge score={payment.fraudScore} />
                <div>
                  <p className="text-2xl font-bold font-mono">
                    {payment.fraudScore.toFixed(1)}
                  </p>
                  {payment.fraudAction && (
                    <FraudActionBadge action={payment.fraudAction} />
                  )}
                </div>
              </div>
            </EnrichmentCard>
          )}
          {payment.fxRate && (
            <EnrichmentCard label="FX Conversion">
              <FxDetails fx={payment.fxRate} />
            </EnrichmentCard>
          )}
          {payment.tokenId && (
            <EnrichmentCard label="Token">
              <span className="px-2.5 py-1 bg-purple-400/10 text-purple-300 text-xs font-mono rounded">
                {payment.tokenId.length > 16
                  ? `${payment.tokenId.slice(0, 10)}...`
                  : payment.tokenId}
              </span>
            </EnrichmentCard>
          )}
        </div>
      )}

      <div className="bg-card border border-card-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">Event Sourcing Tools</h3>
            <p className="text-xs text-muted mt-1">
              Rebuild state from events or query historical state at a point in time.
            </p>
          </div>
          <button
            onClick={handleReplay}
            disabled={replaying}
            className="px-4 py-2 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {replaying ? "Replaying..." : "Replay from Events"}
          </button>
        </div>

        {replayResult && (
          <div className="bg-success/10 border border-success/30 rounded-lg p-4 mb-4">
            <p className="text-sm text-success font-medium mb-1">Replay successful</p>
            <p className="text-xs text-muted">
              State rebuilt from {events.length} events. Status: {replayResult.status}
            </p>
          </div>
        )}

        <div className="border-t border-card-border pt-4">
          <h4 className="text-xs text-muted uppercase tracking-wider mb-3">Temporal Query</h4>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs text-muted mb-1">Point in Time</label>
              <input
                type="datetime-local"
                value={temporalDate}
                onChange={(e) => setTemporalDate(e.target.value)}
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </div>
            <button
              onClick={handleTemporalQuery}
              disabled={temporalLoading || !temporalDate}
              className="px-4 py-2 rounded-lg bg-card-border/50 border border-card-border text-sm text-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {temporalLoading ? "Querying..." : "View State At"}
            </button>
          </div>
          <p className="text-xs text-muted mt-2">
            View the payment state as it existed at any point in time by replaying events up to that moment.
          </p>
        </div>

        {temporalError && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm text-danger mt-4">
            {temporalError}
          </div>
        )}

        {temporalResult && (
          <div className="bg-card-border/20 border border-card-border rounded-lg p-4 mt-4">
            <div className="flex items-center gap-3 mb-2">
              <h4 className="text-sm font-semibold">State at {new Date(temporalDate).toLocaleString()}</h4>
              <StatusBadge status={temporalResult.status} />
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted">Amount:</span>{" "}
                <span className="font-mono">${(temporalResult.amount / 100).toFixed(2)} {temporalResult.currency}</span>
              </div>
              <div>
                <span className="text-muted">Customer:</span>{" "}
                <span className="font-mono">{temporalResult.customerId}</span>
              </div>
              <div>
                <span className="text-muted">Order:</span>{" "}
                <span className="font-mono">{temporalResult.orderId}</span>
              </div>
              <div>
                <span className="text-muted">Updated:</span>{" "}
                <span className="font-mono">{new Date(temporalResult.updatedAt).toLocaleString()}</span>
              </div>
            </div>
            {temporalResult.error && (
              <p className="text-sm text-danger mt-2">{temporalResult.error}</p>
            )}
          </div>
        )}
      </div>

      <div className="bg-card border border-card-border rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-2">Saga Flow</h3>
        <p className="text-xs text-muted mb-4">
          Visual representation of the saga steps. Each step ran execute(). On failure, compensate() runs in reverse.
        </p>
        <SagaFlow completedEvents={completedEventTypes} status={payment.status} />
      </div>

      <div className="bg-card border border-card-border rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-2">Event Sourcing Timeline</h3>
        <p className="text-xs text-muted mb-6">
          Payment state is derived by replaying these events through a reducer. This is the append-only audit trail.
        </p>
        <EventTimeline events={events} />
      </div>
    </div>
  );
}

function EnrichmentCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <p className="text-xs text-muted uppercase tracking-wider mb-3">{label}</p>
      {children}
    </div>
  );
}

function FraudScoreGauge({ score }: { score: number }) {
  const clamped = Math.min(Math.max(score, 0), 100);
  const circumference = 94.25;
  const filled = (clamped / 100) * circumference;
  const color =
    clamped >= 70 ? "text-danger" : clamped >= 40 ? "text-warning" : "text-success";

  return (
    <div className="relative w-14 h-14 shrink-0">
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-card-border"
        />
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          strokeWidth="3"
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
          className={color}
          stroke="currentColor"
        />
      </svg>
    </div>
  );
}

const FRAUD_ACTION_STYLES: Record<string, string> = {
  allow: "bg-success/15 text-success border-success/30",
  review: "bg-warning/15 text-warning border-warning/30",
  block: "bg-danger/15 text-danger border-danger/30",
};

function FraudActionBadge({ action }: { action: string }) {
  const style =
    FRAUD_ACTION_STYLES[action.toLowerCase()] ?? "bg-muted/15 text-muted border-muted/30";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border mt-1 ${style}`}
    >
      {action.toUpperCase()}
    </span>
  );
}

function FxDetails({ fx }: { fx: PaymentFxDetails }) {
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-muted text-xs">
          {(fx.originalAmount / 100).toFixed(2)} {fx.originalCurrency}
        </span>
        <span className="text-muted text-xs">&rarr;</span>
        <span className="font-mono font-medium text-xs">
          {(fx.convertedAmount / 100).toFixed(2)} {fx.convertedCurrency}
        </span>
      </div>
      <p className="text-xs text-muted">
        Rate: <span className="font-mono text-foreground">{fx.rate.toFixed(4)}</span>
      </p>
      <p className="text-xs text-muted">
        Spread: <span className="font-mono text-foreground">{fx.spreadBps} bps</span>
      </p>
    </div>
  );
}

"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { getPayment, getPaymentEvents, type PaymentState, type DomainEvent } from "@/lib/api";
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted animate-pulse">Loading payment...</div>
      </div>
    );
  }

  if (error || !payment) {
    return (
      <div className="space-y-4">
        <Link href="/" className="text-accent text-sm hover:text-accent-hover">&larr; Back</Link>
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-6 text-danger">
          {error || "Payment not found"}
        </div>
      </div>
    );
  }

  const completedEventTypes = events.map((e) => e.eventType);
  const durationMs = events.length >= 2
    ? new Date(events[events.length - 1]!.createdAt).getTime() - new Date(events[0]!.createdAt).getTime()
    : 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-accent text-sm hover:text-accent-hover">&larr; Back</Link>
        <h2 className="text-2xl font-bold">Payment Detail</h2>
      </div>

      {/* Summary Card */}
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

        {/* Items Table */}
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

      {/* Saga Flow Visualization */}
      <div className="bg-card border border-card-border rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-2">Saga Flow</h3>
        <p className="text-xs text-muted mb-4">
          Visual representation of the saga steps. Each step ran execute(). On failure, compensate() runs in reverse.
        </p>
        <SagaFlow completedEvents={completedEventTypes} status={payment.status} />
      </div>

      {/* Event Timeline */}
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

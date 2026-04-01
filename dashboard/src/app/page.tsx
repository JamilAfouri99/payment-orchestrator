"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchHealth, type HealthStatus, type PaymentState } from "@/lib/api";
import { StatusBadge } from "@/components/status-badge";

export default function DashboardPage() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [payments, setPayments] = useState<PaymentState[]>([]);
  const [healthError, setHealthError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const h = await fetchHealth();
      setHealth(h);
      setHealthError(null);
    } catch {
      setHealthError("Cannot connect to API");
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  const addPayment = (payment: PaymentState) => {
    setPayments((prev) => [payment, ...prev]);
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <p className="text-muted text-sm mt-1">Payment orchestration system overview</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="System Health"
          value={healthError ? "Offline" : health?.status ?? "..."}
          badge
        />
        <StatCard
          title="Total Payments"
          value={String(payments.length)}
          subtitle="this session"
        />
        <StatCard
          title="Completed"
          value={String(payments.filter((p) => p.status === "completed").length)}
          badge
        />
        <StatCard
          title="Failed / Compensated"
          value={String(payments.filter((p) => p.status === "failed" || p.status === "compensated").length)}
        />
      </div>

      {/* Pattern Showcase */}
      <div className="bg-card border border-card-border rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4">Patterns Demonstrated</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {patterns.map((p) => (
            <div key={p.name} className="bg-background/50 rounded-lg p-4 border border-card-border/50">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${p.color}`} />
                <h4 className="font-semibold text-sm">{p.name}</h4>
              </div>
              <p className="text-xs text-muted leading-relaxed">{p.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Create */}
      <div className="bg-card border border-card-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Quick Payment</h3>
          <Link
            href="/payments/new"
            className="text-xs text-accent hover:text-accent-hover transition-colors"
          >
            Advanced form &rarr;
          </Link>
        </div>
        <QuickPayment onCreated={addPayment} />
      </div>

      {/* Recent Payments */}
      {payments.length > 0 && (
        <div className="bg-card border border-card-border rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">Recent Payments</h3>
          <div className="space-y-2">
            {payments.map((p) => (
              <Link
                key={p.id}
                href={`/payments/${p.id}`}
                className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-card-border/50 hover:border-accent/30 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <StatusBadge status={p.status} />
                  <span className="font-mono text-xs text-muted">{p.id.slice(0, 8)}...</span>
                  <span className="text-sm">
                    {formatCents(p.amount)} {p.currency}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-muted">{p.customerId}</span>
                  <span className="text-xs text-muted">
                    {new Date(p.createdAt).toLocaleTimeString()}
                  </span>
                  <span className="text-muted">&rarr;</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QuickPayment({ onCreated }: { onCreated: (p: PaymentState) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(preset: "small" | "medium" | "large") {
    setLoading(true);
    setError(null);

    const presets = {
      small: { amount: 1999, items: [{ productId: "prod_basic", quantity: 1, pricePerUnit: 1999 }] },
      medium: { amount: 4999, items: [{ productId: "prod_standard", quantity: 1, pricePerUnit: 4999 }] },
      large: { amount: 15000, items: [{ productId: "prod_premium", quantity: 3, pricePerUnit: 5000 }] },
    };

    const p = presets[preset];
    const key = `quick_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          amount: p.amount,
          currency: "USD",
          customerId: "cust_demo",
          orderId: `ord_${Date.now()}`,
          items: p.items,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Payment failed");
      onCreated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex gap-3">
        {(["small", "medium", "large"] as const).map((size) => (
          <button
            key={size}
            onClick={() => handleCreate(size)}
            disabled={loading}
            className="px-4 py-2.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Processing..." : `${size.charAt(0).toUpperCase() + size.slice(1)} Payment`}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted mt-2">
        Each button creates a payment with a unique idempotency key and runs the full saga flow.
      </p>
      {error && <p className="text-sm text-danger mt-2">{error}</p>}
    </div>
  );
}

function StatCard({ title, value, badge, subtitle }: { title: string; value: string; badge?: boolean; subtitle?: string }) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <p className="text-xs text-muted uppercase tracking-wider mb-1">{title}</p>
      <div className="flex items-center gap-2">
        {badge ? <StatusBadge status={value.toLowerCase()} /> : <p className="text-2xl font-bold">{value}</p>}
      </div>
      {subtitle && <p className="text-xs text-muted mt-1">{subtitle}</p>}
    </div>
  );
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const patterns = [
  { name: "Saga Orchestration", color: "bg-accent", description: "Multi-step payment flow with automatic compensation on failure. Each step defines execute() and compensate()." },
  { name: "Event Sourcing", color: "bg-purple-400", description: "All payment state derived from replaying append-only events. No mutable columns." },
  { name: "Idempotency", color: "bg-teal-400", description: "Idempotency-Key header prevents duplicate processing. Same key returns cached response." },
  { name: "Circuit Breaker", color: "bg-warning", description: "Protects against cascading failures with closed/open/half-open states and exponential backoff." },
  { name: "Webhook Delivery", color: "bg-emerald-400", description: "HMAC-SHA256 signed webhooks with retry policy and dead-letter queue." },
  { name: "Result<T, E>", color: "bg-rose-400", description: "Explicit error handling via discriminated unions instead of thrown exceptions." },
];

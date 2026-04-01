"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  fetchHealth,
  fetchPayments,
  fetchCircuitBreakers,
  fetchBulkheads,
  fetchChargebackRate,
  type HealthStatus,
  type PaymentState,
  type CircuitBreakerInfo,
  type BulkheadStats,
  type ChargebackRateRecord,
} from "@/lib/api";
import { StatusBadge } from "@/components/status-badge";
import { CircuitBreakerCard } from "@/components/circuit-breaker-card";

export default function DashboardPage() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [payments, setPayments] = useState<PaymentState[]>([]);
  const [breakers, setBreakers] = useState<CircuitBreakerInfo[]>([]);
  const [bulkheads, setBulkheads] = useState<BulkheadStats[]>([]);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [cbRate, setCbRate] = useState<ChargebackRateRecord | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      const h = await fetchHealth();
      setHealth(h);
      setHealthError(null);
    } catch {
      setHealthError("Cannot connect to API");
    }
  }, []);

  const loadResilience = useCallback(async () => {
    try {
      const [cb, bh] = await Promise.all([fetchCircuitBreakers(), fetchBulkheads()]);
      setBreakers(cb.breakers);
      setBulkheads(bh.bulkheads);
    } catch {
      // Silently handled -- cards will show stale data
    }
  }, []);

  const loadPayments = useCallback(async () => {
    try {
      const data = await fetchPayments(10, 0);
      setPayments(data.payments);
    } catch {
      // Payments will show empty until API is available
    }
  }, []);

  const loadChargebackRate = useCallback(async () => {
    try {
      const rate = await fetchChargebackRate();
      setCbRate(rate);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    loadHealth();
    loadPayments();
    loadResilience();
    loadChargebackRate();

    const healthInterval = setInterval(loadHealth, 5000);
    const resilienceInterval = setInterval(loadResilience, 3000);
    return () => {
      clearInterval(healthInterval);
      clearInterval(resilienceInterval);
    };
  }, [loadHealth, loadPayments, loadResilience, loadChargebackRate]);

  const addPayment = (payment: PaymentState) => {
    setPayments((prev) => [payment, ...prev.slice(0, 9)]);
  };

  const completedCount = payments.filter((p) => p.status === "completed").length;
  const failedCount = payments.filter((p) => p.status === "failed" || p.status === "compensated").length;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <p className="text-muted text-sm mt-1">Payment orchestration system overview</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="System Health"
          value={healthError ? "Offline" : health?.status ?? "..."}
          badge
        />
        <StatCard
          title="Total Payments"
          value={String(payments.length)}
          subtitle="loaded from API"
        />
        <StatCard
          title="Completed"
          value={String(completedCount)}
          badge
        />
        <StatCard
          title="Failed / Compensated"
          value={String(failedCount)}
        />
      </div>

      {cbRate && <ChargebackRateWidget rate={cbRate} />}

      {breakers.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3">Circuit Breakers</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {breakers.map((b) => (
              <CircuitBreakerCard key={b.name} breaker={b} onReset={loadResilience} />
            ))}
          </div>
        </div>
      )}

      {bulkheads.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3">Bulkheads</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {bulkheads.map((bh) => (
              <div key={bh.name} className="bg-card border border-card-border rounded-xl p-5">
                <p className="text-sm font-semibold mb-2">{bh.name}</p>
                <div className="space-y-2">
                  <BulkheadBar
                    label="Concurrency"
                    used={bh.activeCount}
                    max={bh.maxConcurrent}
                  />
                  <BulkheadBar
                    label="Queue"
                    used={bh.queueSize}
                    max={bh.maxQueue}
                  />
                </div>
                <p className="text-xs text-muted mt-2">
                  {bh.availableSlots} slot{bh.availableSlots !== 1 ? "s" : ""} available
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {payments.length > 0 && (
        <div className="bg-card border border-card-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Recent Payments</h3>
            <Link href="/payments" className="text-xs text-accent hover:text-accent-hover transition-colors">
              View all &rarr;
            </Link>
          </div>
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

function BulkheadBar({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
  const color = pct > 80 ? "bg-danger" : pct > 50 ? "bg-warning" : "bg-accent";
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-muted mb-1">
        <span>{label}</span>
        <span>{used}/{max}</span>
      </div>
      <div className="w-full h-1.5 bg-card-border rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
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

const CB_THRESHOLD_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  normal: { color: "text-success", bg: "bg-success", label: "Normal" },
  warning: { color: "text-warning", bg: "bg-warning", label: "Warning (>0.65%)" },
  excessive: { color: "text-orange-400", bg: "bg-orange-400", label: "Excessive (>0.9%)" },
  critical: { color: "text-danger", bg: "bg-danger", label: "Critical (>1.0%)" },
};

function ChargebackRateWidget({ rate }: { rate: ChargebackRateRecord }) {
  const style = CB_THRESHOLD_STYLES[rate.threshold] ?? CB_THRESHOLD_STYLES.normal!;
  const pct = Math.min(rate.rate * 100, 2);

  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Chargeback Rate</h3>
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${style.color} bg-card-border/50`}>
          {style.label}
        </span>
      </div>
      <div className="flex items-center gap-6">
        {/* Gauge */}
        <svg width="80" height="48" viewBox="0 0 80 48">
          <path d="M 8 44 A 32 32 0 0 1 72 44" fill="none" stroke="currentColor" className="text-card-border" strokeWidth="5" strokeLinecap="round" />
          {/* Green zone: 0-0.65% */}
          <path d="M 8 44 A 32 32 0 0 1 72 44" fill="none" stroke="currentColor" className="text-success/30" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={`${(0.65 / 2) * 100.5} 100.5`} />
          {/* Warning zone: 0.65-0.9% */}
          <path d="M 8 44 A 32 32 0 0 1 72 44" fill="none" stroke="currentColor" className="text-warning/30" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={`${(0.9 / 2) * 100.5} 100.5`} strokeDashoffset={`${-(0.65 / 2) * 100.5}`} />
          {/* Needle */}
          <path d="M 8 44 A 32 32 0 0 1 72 44" fill="none" stroke="currentColor" className={style.color} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={`${(pct / 2) * 100.5} 100.5`} />
        </svg>
        <div>
          <p className={`text-2xl font-bold ${style.color}`}>{rate.ratePercent}</p>
          <p className="text-xs text-muted">{rate.disputeCount} disputes / {rate.transactionCount} txns</p>
          <p className="text-xs text-muted">{rate.windowDays}-day rolling window</p>
        </div>
        {/* Threshold scale */}
        <div className="flex-1 space-y-1 text-xs">
          <ThresholdBar label="Normal" max={0.65} color="bg-success/40" />
          <ThresholdBar label="Warning" max={0.90} color="bg-warning/40" />
          <ThresholdBar label="Excessive" max={1.0} color="bg-orange-400/40" />
          <ThresholdBar label="Critical" max={2.0} color="bg-danger/40" />
        </div>
      </div>
      {rate.blocked && (
        <div className="mt-3 p-2 rounded bg-danger/10 border border-danger/30 text-danger text-xs font-medium">
          New payments are blocked due to excessive chargeback rate
        </div>
      )}
    </div>
  );
}

function ThresholdBar({ label, max, color }: { label: string; max: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-muted">{label}</span>
      <div className="flex-1 h-1.5 bg-card-border rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min((max / 2) * 100, 100)}%` }} />
      </div>
      <span className="text-muted w-10 text-right">{max}%</span>
    </div>
  );
}

const patterns = [
  { name: "Saga Orchestration", color: "bg-accent", description: "Multi-step payment flow with automatic compensation on failure. Each step defines execute() and compensate()." },
  { name: "Event Sourcing", color: "bg-purple-400", description: "All payment state derived from replaying append-only events. No mutable columns." },
  { name: "Idempotency", color: "bg-teal-400", description: "Idempotency-Key header prevents duplicate processing. Same key returns cached response." },
  { name: "Circuit Breaker", color: "bg-warning", description: "Protects against cascading failures with closed/open/half-open states and exponential backoff." },
  { name: "Webhook Delivery", color: "bg-emerald-400", description: "HMAC-SHA256 signed webhooks with retry policy and dead-letter queue." },
  { name: "Result<T, E>", color: "bg-rose-400", description: "Explicit error handling via discriminated unions instead of thrown exceptions." },
];

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchProviders,
  fetchProviderMetrics,
  simulateRouting,
  type ProviderInfo,
  type ProviderStats,
  type RoutingDecision,
} from "@/lib/api";

const CB_COLORS: Record<string, string> = {
  closed: "bg-success/15 text-success border-success/30",
  open: "bg-danger/15 text-danger border-danger/30",
  "half-open": "bg-warning/15 text-warning border-warning/30",
};

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "SGD", "HKD"];
const REGIONS = ["US", "EU", "GB", "APAC", "CA", "AU"];
const WINDOWS = ["1m", "5m", "15m", "1h"] as const;
type Window = (typeof WINDOWS)[number];

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [stats, setStats] = useState<ProviderStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [window, setWindow] = useState<Window>("5m");

  // Routing simulator state
  const [simAmount, setSimAmount] = useState("5000");
  const [simCurrency, setSimCurrency] = useState("USD");
  const [simRegion, setSimRegion] = useState("US");
  const [simResult, setSimResult] = useState<RoutingDecision | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    try {
      const data = await fetchProviders();
      setProviders(data.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers");
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const data = await fetchProviderMetrics(window);
      setStats(data.stats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, [window]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    setLoading(true);
    loadStats();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, [loadStats]);

  async function handleSimulate() {
    const amount = parseInt(simAmount, 10);
    if (!amount || amount <= 0) {
      setSimError("Amount must be a positive number (in cents)");
      return;
    }
    setSimLoading(true);
    setSimError(null);
    setSimResult(null);
    try {
      const result = await simulateRouting(amount, simCurrency, simRegion);
      setSimResult(result);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setSimLoading(false);
    }
  }

  function getStatsForProvider(name: string): ProviderStats | undefined {
    return stats.find((s) => s.provider === name);
  }

  if (loading && providers.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted animate-pulse">Loading provider data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Provider Performance</h2>
          <p className="text-muted text-sm mt-1">
            Real-time metrics and routing simulation across payment providers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Window:</span>
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  window === w
                    ? "bg-accent text-white"
                    : "bg-card border border-card-border text-muted hover:text-foreground"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-sm text-danger flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => { loadProviders(); loadStats(); }}
            className="text-xs underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Provider cards */}
      {providers.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {providers.map((provider) => {
            const s = getStatsForProvider(provider.name);
            const cbStyle = CB_COLORS[provider.circuitBreaker.toLowerCase()] ?? "bg-muted/15 text-muted border-muted/30";

            return (
              <div
                key={provider.name}
                className="bg-card border border-card-border rounded-xl p-5 space-y-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-base">{provider.name}</h3>
                    <p className="text-xs text-muted mt-0.5">
                      Settlement: {provider.settlementCurrency}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cbStyle}`}
                  >
                    {provider.circuitBreaker}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <MetricCell
                    label="Success Rate"
                    value={s ? `${(s.successRate * 100).toFixed(1)}%` : "—"}
                    highlight={s ? successRateColor(s.successRate) : undefined}
                  />
                  <MetricCell
                    label="Cost"
                    value={`${provider.costBasisPoints} bps`}
                  />
                  <MetricCell
                    label="Avg Latency"
                    value={s ? `${s.avgLatencyMs.toFixed(0)}ms` : "—"}
                  />
                  <MetricCell
                    label="Total Reqs"
                    value={s ? String(s.totalRequests) : "—"}
                  />
                </div>

                {s && (
                  <div>
                    <p className="text-xs text-muted mb-1.5">Latency percentiles</p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <PercentileCell label="p50" value={s.p50LatencyMs} />
                      <PercentileCell label="p95" value={s.p95LatencyMs} />
                      <PercentileCell label="p99" value={s.p99LatencyMs} />
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <p className="text-xs text-muted">Currencies</p>
                  <div className="flex flex-wrap gap-1">
                    {provider.supportedCurrencies.map((c) => (
                      <span
                        key={c}
                        className="px-1.5 py-0.5 bg-accent/10 text-accent text-xs rounded font-mono"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs text-muted">Regions</p>
                  <div className="flex flex-wrap gap-1">
                    {provider.supportedRegions.map((r) => (
                      <span
                        key={r}
                        className="px-1.5 py-0.5 bg-card-border/80 text-foreground text-xs rounded font-mono"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Stats table */}
      {stats.length > 0 && (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="p-5 border-b border-card-border">
            <h3 className="font-semibold">Metrics Comparison</h3>
            <p className="text-xs text-muted mt-0.5">
              Auto-refreshes every 5 seconds — window: {window}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-card-border">
                  <th className="px-5 py-3 font-medium">Provider</th>
                  <th className="px-5 py-3 font-medium text-right">Requests</th>
                  <th className="px-5 py-3 font-medium text-right">Success</th>
                  <th className="px-5 py-3 font-medium text-right">Failed</th>
                  <th className="px-5 py-3 font-medium text-right">Success %</th>
                  <th className="px-5 py-3 font-medium text-right">Avg ms</th>
                  <th className="px-5 py-3 font-medium text-right">p50</th>
                  <th className="px-5 py-3 font-medium text-right">p95</th>
                  <th className="px-5 py-3 font-medium text-right">p99</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr
                    key={s.provider}
                    className="border-t border-card-border/50 hover:bg-card-border/20 transition-colors"
                  >
                    <td className="px-5 py-3 font-medium">{s.provider}</td>
                    <td className="px-5 py-3 text-right text-muted">{s.totalRequests}</td>
                    <td className="px-5 py-3 text-right text-success">{s.successCount}</td>
                    <td className="px-5 py-3 text-right text-danger">{s.failureCount}</td>
                    <td className="px-5 py-3 text-right">
                      <span className={successRateColor(s.successRate)}>
                        {(s.successRate * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-muted font-mono">
                      {s.avgLatencyMs.toFixed(0)}
                    </td>
                    <td className="px-5 py-3 text-right text-muted font-mono">
                      {s.p50LatencyMs.toFixed(0)}
                    </td>
                    <td className="px-5 py-3 text-right text-muted font-mono">
                      {s.p95LatencyMs.toFixed(0)}
                    </td>
                    <td className="px-5 py-3 text-right text-muted font-mono">
                      {s.p99LatencyMs.toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Routing simulator */}
      <div className="bg-card border border-card-border rounded-xl p-6">
        <h3 className="font-semibold mb-1">Routing Simulator</h3>
        <p className="text-xs text-muted mb-5">
          See which provider would be selected for a given payment without creating a real transaction.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs text-muted mb-1.5">Amount (cents)</label>
            <input
              type="number"
              value={simAmount}
              onChange={(e) => setSimAmount(e.target.value)}
              placeholder="5000"
              min="1"
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1.5">Currency</label>
            <select
              value={simCurrency}
              onChange={(e) => setSimCurrency(e.target.value)}
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1.5">Region</label>
            <select
              value={simRegion}
              onChange={(e) => setSimRegion(e.target.value)}
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleSimulate}
          disabled={simLoading}
          className="px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {simLoading ? "Simulating..." : "Simulate Routing"}
        </button>

        {simError && (
          <p className="text-sm text-danger mt-3">{simError}</p>
        )}

        {simResult && (
          <div className="mt-5 space-y-4">
            <div className="bg-success/10 border border-success/30 rounded-lg p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1">
                  <p className="text-xs text-muted mb-0.5">Selected Provider</p>
                  <p className="font-semibold text-lg">{simResult.providerId}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted mb-0.5">Score</p>
                  <p className="font-mono text-xl font-bold text-success">
                    {simResult.score.toFixed(3)}
                  </p>
                </div>
              </div>
              {simResult.reasons.length > 0 && (
                <div>
                  <p className="text-xs text-muted mb-1.5">Reasons</p>
                  <ul className="space-y-1">
                    {simResult.reasons.map((r, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <span className="text-success mt-0.5">+</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {simResult.fallbackOrder.length > 0 && (
              <div>
                <p className="text-xs text-muted mb-2">Fallback order</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {simResult.fallbackOrder.map((id, i) => (
                    <div key={id} className="flex items-center gap-2">
                      {i > 0 && <span className="text-muted text-xs">&rarr;</span>}
                      <span className="px-2.5 py-1 bg-card-border/50 rounded text-xs font-mono">
                        {i + 1}. {id}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: string;
}) {
  return (
    <div className="bg-background/40 rounded-lg p-2.5">
      <p className="text-xs text-muted mb-0.5">{label}</p>
      <p className={`text-sm font-semibold font-mono ${highlight ?? "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

function PercentileCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-background/40 rounded p-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xs font-mono font-medium mt-0.5">{value.toFixed(0)}ms</p>
    </div>
  );
}

function successRateColor(rate: number): string {
  if (rate >= 0.95) return "text-success";
  if (rate >= 0.8) return "text-warning";
  return "text-danger";
}

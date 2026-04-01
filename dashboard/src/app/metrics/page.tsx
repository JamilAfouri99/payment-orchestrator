"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchMetrics, type MetricsSnapshot } from "@/lib/api";

const COUNTER_DISPLAY: { key: string; label: string; color: string }[] = [
  { key: "http_requests_total", label: "HTTP Requests", color: "text-accent" },
  { key: "payments_created", label: "Payments Created", color: "text-accent" },
  { key: "payments_completed", label: "Payments Completed", color: "text-success" },
  { key: "payments_failed", label: "Payments Failed", color: "text-danger" },
  { key: "saga_compensations", label: "Saga Compensations", color: "text-warning" },
  { key: "webhook_deliveries", label: "Webhook Deliveries", color: "text-emerald-400" },
  { key: "dlq_entries", label: "DLQ Entries", color: "text-danger" },
];

const HISTOGRAM_DISPLAY = [
  { key: "http_request_duration_ms", label: "HTTP Request Duration" },
  { key: "saga_step_duration_ms", label: "Saga Step Duration" },
];

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchMetrics();
      setMetrics(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading && !metrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted animate-pulse">Loading metrics...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Metrics</h2>
          <p className="text-muted text-sm mt-1">
            System counters and latency histograms, refreshed every 5 seconds
          </p>
        </div>
        <div className="text-right">
          {lastUpdated && (
            <p className="text-xs text-muted">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
          <button
            onClick={load}
            className="mt-1 px-3 py-1.5 rounded-lg bg-card border border-card-border text-xs text-muted hover:text-foreground transition-colors"
          >
            Refresh Now
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-sm text-danger">
          {error}
        </div>
      )}

      {metrics && (
        <>
          <div>
            <h3 className="text-lg font-semibold mb-3">Counters</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {COUNTER_DISPLAY.map((counter) => {
                const value = metrics.counters[counter.key] ?? 0;
                return (
                  <div key={counter.key} className="bg-card border border-card-border rounded-xl p-5">
                    <p className="text-xs text-muted uppercase tracking-wider mb-1">{counter.label}</p>
                    <p className={`text-3xl font-bold font-mono ${counter.color}`}>{value.toLocaleString()}</p>
                    <p className="text-xs text-muted font-mono mt-1">{counter.key}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-3">Histograms</h3>
            <div className="space-y-6">
              {HISTOGRAM_DISPLAY.map((hist) => {
                const data = metrics.histograms[hist.key];
                if (!data) return null;
                return (
                  <div key={hist.key} className="bg-card border border-card-border rounded-xl p-6">
                    <h4 className="font-semibold mb-1">{hist.label}</h4>
                    <p className="text-xs text-muted font-mono mb-4">{hist.key}</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted uppercase tracking-wider border-b border-card-border">
                            <th className="pb-2 pr-6">Count</th>
                            <th className="pb-2 pr-6 text-right">Avg</th>
                            <th className="pb-2 pr-6 text-right">Min</th>
                            <th className="pb-2 pr-6 text-right">Max</th>
                            <th className="pb-2 pr-6 text-right">p50</th>
                            <th className="pb-2 pr-6 text-right">p95</th>
                            <th className="pb-2 text-right">p99</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="py-3 pr-6 font-mono">{data.count}</td>
                            <td className="py-3 pr-6 text-right font-mono">{data.avg.toFixed(1)}ms</td>
                            <td className="py-3 pr-6 text-right font-mono">{data.min.toFixed(1)}ms</td>
                            <td className="py-3 pr-6 text-right font-mono">{data.max.toFixed(1)}ms</td>
                            <td className="py-3 pr-6 text-right font-mono text-success">{data.p50.toFixed(1)}ms</td>
                            <td className="py-3 pr-6 text-right font-mono text-warning">{data.p95.toFixed(1)}ms</td>
                            <td className="py-3 text-right font-mono text-danger">{data.p99.toFixed(1)}ms</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4">
                      <PercentileBar p50={data.p50} p95={data.p95} p99={data.p99} max={data.max} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {metrics.collectedAt && (
            <p className="text-xs text-muted text-right">
              Metrics collected at: {new Date(metrics.collectedAt).toLocaleString()}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function PercentileBar({ p50, p95, p99, max }: { p50: number; p95: number; p99: number; max: number }) {
  const scale = max > 0 ? max : 1;
  const p50Pct = (p50 / scale) * 100;
  const p95Pct = (p95 / scale) * 100;
  const p99Pct = (p99 / scale) * 100;

  return (
    <div className="relative h-3 bg-card-border rounded-full overflow-hidden">
      <div
        className="absolute inset-y-0 left-0 bg-success/40 rounded-full"
        style={{ width: `${Math.min(p99Pct, 100)}%` }}
      />
      <div
        className="absolute inset-y-0 left-0 bg-warning/50 rounded-full"
        style={{ width: `${Math.min(p95Pct, 100)}%` }}
      />
      <div
        className="absolute inset-y-0 left-0 bg-success rounded-full"
        style={{ width: `${Math.min(p50Pct, 100)}%` }}
      />
      <div className="absolute inset-0 flex items-center justify-end pr-2">
        <span className="text-[10px] font-mono text-foreground/80">{max.toFixed(0)}ms max</span>
      </div>
    </div>
  );
}

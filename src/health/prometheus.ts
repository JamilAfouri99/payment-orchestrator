import type { MetricsCollector, HistogramData } from "../metrics/metrics-collector.js";
import type { CircuitBreakerRegistry } from "../circuit-breaker/circuit-breaker-registry.js";
import type { QueueService } from "../queue/queue-service.js";
import { ALL_QUEUE_NAMES } from "../queue/queue-service.js";

interface PrometheusExporterDeps {
  metrics: MetricsCollector;
  cbRegistry: CircuitBreakerRegistry;
  queueService?: QueueService | undefined;
}

/**
 * Converts in-memory metrics to Prometheus exposition format.
 */
export function createPrometheusExporter(deps: PrometheusExporterDeps) {
  const { metrics, cbRegistry, queueService } = deps;

  return {
    async format(): Promise<string> {
      const lines: string[] = [];
      const snapshot = metrics.snapshot();

      // Counters
      const counterEntries = Object.entries(snapshot.counters);
      if (counterEntries.length > 0) {
        const grouped = groupByMetricName(counterEntries);
        for (const [baseName, entries] of grouped) {
          const promName = sanitizeName(baseName);
          lines.push(`# HELP ${promName}_total ${baseName.replace(/_/g, " ")}`);
          lines.push(`# TYPE ${promName}_total counter`);
          for (const [fullKey, value] of entries) {
            const labels = extractLabels(fullKey, baseName);
            lines.push(`${promName}_total${labels} ${value}`);
          }
          lines.push("");
        }
      }

      // Histograms
      const histogramEntries = Object.entries(snapshot.histograms);
      if (histogramEntries.length > 0) {
        const grouped = groupByMetricName(histogramEntries);
        for (const [baseName, entries] of grouped) {
          const promName = sanitizeName(baseName);
          lines.push(`# HELP ${promName}_seconds ${baseName.replace(/_/g, " ")}`);
          lines.push(`# TYPE ${promName}_seconds histogram`);
          for (const [fullKey, data] of entries) {
            const labels = extractLabels(fullKey, baseName);
            const hist = data as HistogramData;
            const buckets = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
            for (const bound of buckets) {
              const boundMs = bound * 1000;
              const count = estimateBucketCount(hist, boundMs);
              lines.push(`${promName}_seconds_bucket${insertLabel(labels, "le", String(bound))} ${count}`);
            }
            lines.push(`${promName}_seconds_bucket${insertLabel(labels, "le", "+Inf")} ${hist.count}`);
            lines.push(`${promName}_seconds_sum${labels} ${(hist.sum / 1000).toFixed(3)}`);
            lines.push(`${promName}_seconds_count${labels} ${hist.count}`);
          }
          lines.push("");
        }
      }

      // Circuit breaker gauges
      const cbStates: Record<string, number> = { closed: 0, "half-open": 1, open: 2 };
      const providerNames = ["stripe", "adyen", "paypal", "inventory-service", "notification-service"];
      lines.push("# HELP circuit_breaker_state Circuit breaker state (0=closed, 1=half-open, 2=open)");
      lines.push("# TYPE circuit_breaker_state gauge");
      for (const name of providerNames) {
        const breaker = cbRegistry.get(name);
        const state = breaker ? breaker.getState() : "closed";
        const value = cbStates[state] ?? 0;
        lines.push(`circuit_breaker_state{provider="${name}"} ${value}`);
      }
      lines.push("");

      // Queue depth gauges
      if (queueService) {
        lines.push("# HELP queue_depth Number of jobs waiting in queue");
        lines.push("# TYPE queue_depth gauge");
        lines.push("# HELP queue_active Number of jobs actively processing");
        lines.push("# TYPE queue_active gauge");
        lines.push("# HELP queue_failed Total failed jobs in queue");
        lines.push("# TYPE queue_failed gauge");
        try {
          const stats = await queueService.getQueueStats();
          for (const stat of stats) {
            lines.push(`queue_depth{queue="${stat.name}"} ${stat.waiting + stat.delayed}`);
            lines.push(`queue_active{queue="${stat.name}"} ${stat.active}`);
            lines.push(`queue_failed{queue="${stat.name}"} ${stat.failed}`);
          }
        } catch {
          for (const name of ALL_QUEUE_NAMES) {
            lines.push(`queue_depth{queue="${name}"} 0`);
            lines.push(`queue_active{queue="${name}"} 0`);
            lines.push(`queue_failed{queue="${name}"} 0`);
          }
        }
        lines.push("");
      }

      return lines.join("\n");
    },
  };
}

function sanitizeName(name: string): string {
  // Strip label portion and replace non-alphanumeric chars
  const base = name.split("{")[0]!;
  return base.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}

function extractLabels(fullKey: string, _baseName: string): string {
  const labelStart = fullKey.indexOf("{");
  if (labelStart === -1) return "";
  return fullKey.slice(labelStart);
}

function insertLabel(existing: string, key: string, value: string): string {
  const newLabel = `${key}="${value}"`;
  if (existing === "") return `{${newLabel}}`;
  // Insert before closing brace
  return existing.slice(0, -1) + `,${newLabel}}`;
}

function estimateBucketCount(hist: HistogramData, boundMs: number): number {
  // Approximate: use percentiles to estimate bucket counts
  if (boundMs >= hist.max) return hist.count;
  if (boundMs <= hist.min) return 0;

  // Linear interpolation between known percentile points
  const points = [
    { pct: 0, value: hist.min },
    { pct: 50, value: hist.p50 },
    { pct: 95, value: hist.p95 },
    { pct: 99, value: hist.p99 },
    { pct: 100, value: hist.max },
  ];

  for (let i = 0; i < points.length - 1; i++) {
    const lo = points[i]!;
    const hi = points[i + 1]!;
    if (boundMs >= lo.value && boundMs <= hi.value) {
      const ratio = hi.value === lo.value ? 1 : (boundMs - lo.value) / (hi.value - lo.value);
      const pct = lo.pct + ratio * (hi.pct - lo.pct);
      return Math.round((pct / 100) * hist.count);
    }
  }

  return hist.count;
}

function groupByMetricName<T>(entries: [string, T][]): Map<string, [string, T][]> {
  const grouped = new Map<string, [string, T][]>();
  for (const [key, value] of entries) {
    const baseName = key.split("{")[0]!;
    const list = grouped.get(baseName) ?? [];
    list.push([key, value]);
    grouped.set(baseName, list);
  }
  return grouped;
}

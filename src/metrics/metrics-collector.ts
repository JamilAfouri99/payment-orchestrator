/**
 * In-memory metrics collector for counters and histograms.
 * Exposes data for the admin metrics endpoint and dashboard.
 */
export interface MetricsCollector {
  /** Increments a counter by 1 (or a custom amount) */
  increment(name: string, labels?: Record<string, string>, amount?: number): void;

  /** Records a duration value in a histogram bucket */
  recordDuration(name: string, durationMs: number, labels?: Record<string, string>): void;

  /** @returns All current counter values */
  getCounters(): Record<string, number>;

  /** @returns All histogram data (count, sum, avg, p50, p95, p99) */
  getHistograms(): Record<string, HistogramData>;

  /** @returns Full snapshot of all metrics */
  snapshot(): MetricsSnapshot;

  /** Resets all metrics to zero */
  reset(): void;
}

export interface HistogramData {
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  histograms: Record<string, HistogramData>;
  collectedAt: string;
}

/**
 * Creates an in-memory metrics collector.
 * @returns MetricsCollector instance
 */
export function createMetricsCollector(): MetricsCollector {
  const counters = new Map<string, number>();
  const histogramValues = new Map<string, number[]>();

  function key(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) return name;
    const parts = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`);
    return `${name}{${parts.join(",")}}`;
  }

  return {
    increment(name, labels, amount = 1) {
      const k = key(name, labels);
      counters.set(k, (counters.get(k) ?? 0) + amount);
    },

    recordDuration(name, durationMs, labels) {
      const k = key(name, labels);
      const values = histogramValues.get(k) ?? [];
      values.push(durationMs);
      if (values.length > 10000) values.shift();
      histogramValues.set(k, values);
    },

    getCounters() {
      const result: Record<string, number> = {};
      for (const [k, v] of counters) result[k] = v;
      return result;
    },

    getHistograms() {
      const result: Record<string, HistogramData> = {};
      for (const [k, values] of histogramValues) {
        if (values.length === 0) continue;
        const sorted = [...values].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        result[k] = {
          count: sorted.length,
          sum,
          avg: sum / sorted.length,
          min: sorted[0]!,
          max: sorted[sorted.length - 1]!,
          p50: percentile(sorted, 50),
          p95: percentile(sorted, 95),
          p99: percentile(sorted, 99),
        };
      }
      return result;
    },

    snapshot() {
      return {
        counters: this.getCounters(),
        histograms: this.getHistograms(),
        collectedAt: new Date().toISOString(),
      };
    },

    reset() {
      counters.clear();
      histogramValues.clear();
    },
  };
}

function percentile(sorted: number[], pct: number): number {
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

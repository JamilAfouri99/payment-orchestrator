import { describe, it, expect, vi } from "vitest";
import { createPrometheusExporter } from "./prometheus.js";

function createMockMetrics() {
  const counters: Record<string, number> = {
    "payments_via_api": 150,
    "webhook_retries_processed": 25,
    'queue_jobs_completed{queue="payment-processing"}': 100,
    'queue_jobs_failed{queue="payment-processing"}': 3,
  };

  const histograms: Record<string, import("../metrics/metrics-collector.js").HistogramData> = {
    "request_duration": {
      count: 1000,
      sum: 45000,
      avg: 45,
      min: 5,
      max: 800,
      p50: 30,
      p95: 150,
      p99: 500,
    },
  };

  return {
    snapshot: () => ({
      counters,
      histograms,
      collectedAt: new Date().toISOString(),
    }),
    getCounters: () => counters,
    getHistograms: () => histograms,
    increment: vi.fn(),
    recordDuration: vi.fn(),
    reset: vi.fn(),
  } as unknown as import("../metrics/metrics-collector.js").MetricsCollector;
}

function createMockCbRegistry() {
  const breakers = new Map<string, { getState: () => string }>([
    ["stripe", { getState: () => "closed" }],
    ["adyen", { getState: () => "half-open" }],
    ["paypal", { getState: () => "open" }],
  ]);
  return {
    get: (name: string) => breakers.get(name) ?? null,
  } as unknown as import("../circuit-breaker/circuit-breaker-registry.js").CircuitBreakerRegistry;
}

describe("PrometheusExporter", () => {
  it("formats counters with _total suffix", async () => {
    const exporter = createPrometheusExporter({
      metrics: createMockMetrics(),
      cbRegistry: createMockCbRegistry(),
    });

    const output = await exporter.format();
    expect(output).toContain("payments_via_api_total 150");
    expect(output).toContain("# TYPE payments_via_api_total counter");
  });

  it("formats counters with labels", async () => {
    const exporter = createPrometheusExporter({
      metrics: createMockMetrics(),
      cbRegistry: createMockCbRegistry(),
    });

    const output = await exporter.format();
    expect(output).toContain("queue_jobs_completed_total");
    expect(output).toContain('queue="payment-processing"');
  });

  it("formats histograms with bucket boundaries", async () => {
    const exporter = createPrometheusExporter({
      metrics: createMockMetrics(),
      cbRegistry: createMockCbRegistry(),
    });

    const output = await exporter.format();
    expect(output).toContain("request_duration_seconds_bucket");
    expect(output).toContain('le="0.1"');
    expect(output).toContain('le="0.5"');
    expect(output).toContain('le="+Inf"');
  });

  it("includes histogram sum and count", async () => {
    const exporter = createPrometheusExporter({
      metrics: createMockMetrics(),
      cbRegistry: createMockCbRegistry(),
    });

    const output = await exporter.format();
    expect(output).toContain("request_duration_seconds_sum 45.000");
    expect(output).toContain("request_duration_seconds_count 1000");
  });

  it("includes circuit breaker gauges", async () => {
    const exporter = createPrometheusExporter({
      metrics: createMockMetrics(),
      cbRegistry: createMockCbRegistry(),
    });

    const output = await exporter.format();
    expect(output).toContain("# TYPE circuit_breaker_state gauge");
    expect(output).toContain('circuit_breaker_state{provider="stripe"} 0');
    expect(output).toContain('circuit_breaker_state{provider="adyen"} 1');
    expect(output).toContain('circuit_breaker_state{provider="paypal"} 2');
  });

  it("includes HELP comments", async () => {
    const exporter = createPrometheusExporter({
      metrics: createMockMetrics(),
      cbRegistry: createMockCbRegistry(),
    });

    const output = await exporter.format();
    expect(output).toContain("# HELP");
    expect(output).toContain("# TYPE");
  });

  it("histogram +Inf bucket equals total count", async () => {
    const exporter = createPrometheusExporter({
      metrics: createMockMetrics(),
      cbRegistry: createMockCbRegistry(),
    });

    const output = await exporter.format();
    const infLine = output.split("\n").find((l) => l.includes('le="+Inf"'));
    expect(infLine).toContain("1000");
  });

  it("includes queue gauges when queue service provided", async () => {
    const mockQueueService = {
      getQueueStats: vi.fn().mockResolvedValue([
        { name: "payment-processing", waiting: 5, active: 2, completed: 100, failed: 3, delayed: 1, paused: false },
        { name: "webhook-delivery", waiting: 0, active: 0, completed: 50, failed: 1, delayed: 0, paused: false },
      ]),
    } as unknown as import("../queue/queue-service.js").QueueService;

    const exporter = createPrometheusExporter({
      metrics: createMockMetrics(),
      cbRegistry: createMockCbRegistry(),
      queueService: mockQueueService,
    });

    const output = await exporter.format();
    expect(output).toContain("# TYPE queue_depth gauge");
    expect(output).toContain('queue_depth{queue="payment-processing"} 6');
    expect(output).toContain('queue_active{queue="payment-processing"} 2');
    expect(output).toContain('queue_failed{queue="payment-processing"} 3');
  });

  it("omits queue gauges when no queue service", async () => {
    const exporter = createPrometheusExporter({
      metrics: createMockMetrics(),
      cbRegistry: createMockCbRegistry(),
    });

    const output = await exporter.format();
    expect(output).not.toContain("queue_depth");
  });
});

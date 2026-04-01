import { describe, it, expect, beforeEach } from "vitest";
import { createMetricsCollector, type MetricsCollector } from "./metrics-collector.js";

describe("MetricsCollector", () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = createMetricsCollector();
  });

  it("increments counters", () => {
    metrics.increment("requests_total");
    metrics.increment("requests_total");
    expect(metrics.getCounters()["requests_total"]).toBe(2);
  });

  it("increments counters with labels", () => {
    metrics.increment("http_requests", { method: "GET", status: "200" });
    metrics.increment("http_requests", { method: "POST", status: "201" });
    const counters = metrics.getCounters();
    expect(counters['http_requests{method=GET,status=200}']).toBe(1);
    expect(counters['http_requests{method=POST,status=201}']).toBe(1);
  });

  it("records histogram durations", () => {
    metrics.recordDuration("latency", 100);
    metrics.recordDuration("latency", 200);
    metrics.recordDuration("latency", 300);
    const hist = metrics.getHistograms()["latency"];
    expect(hist).toBeDefined();
    expect(hist!.count).toBe(3);
    expect(hist!.avg).toBe(200);
    expect(hist!.min).toBe(100);
    expect(hist!.max).toBe(300);
  });

  it("computes percentiles", () => {
    for (let i = 1; i <= 100; i++) {
      metrics.recordDuration("latency", i);
    }
    const hist = metrics.getHistograms()["latency"]!;
    expect(hist.p50).toBe(50);
    expect(hist.p95).toBe(95);
    expect(hist.p99).toBe(99);
  });

  it("returns a full snapshot", () => {
    metrics.increment("test");
    metrics.recordDuration("dur", 42);
    const snap = metrics.snapshot();
    expect(snap.counters["test"]).toBe(1);
    expect(snap.histograms["dur"]).toBeDefined();
    expect(snap.collectedAt).toBeDefined();
  });

  it("resets all metrics", () => {
    metrics.increment("test");
    metrics.recordDuration("dur", 42);
    metrics.reset();
    expect(Object.keys(metrics.getCounters())).toHaveLength(0);
    expect(Object.keys(metrics.getHistograms())).toHaveLength(0);
  });
});

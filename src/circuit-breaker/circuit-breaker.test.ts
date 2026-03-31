import { describe, it, expect, beforeEach } from "vitest";
import { createCircuitBreaker, calculateBackoff, type CircuitBreaker } from "./circuit-breaker.js";
import { ok, err } from "../core/result.js";

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = createCircuitBreaker({
      name: "test",
      failureThreshold: 3,
      timeoutMs: 1000,
    });
  });

  it("starts in closed state", () => {
    expect(cb.getState()).toBe("closed");
  });

  it("passes through successful calls in closed state", async () => {
    const result = await cb.execute(async () => ok("success"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("success");
    expect(cb.getState()).toBe("closed");
  });

  it("opens after reaching failure threshold", async () => {
    const fail = async () => err(new Error("fail"));

    await cb.execute(fail);
    expect(cb.getState()).toBe("closed");

    await cb.execute(fail);
    expect(cb.getState()).toBe("closed");

    await cb.execute(fail);
    expect(cb.getState()).toBe("open");
  });

  it("rejects requests when open", async () => {
    const fail = async () => err(new Error("fail"));
    for (let i = 0; i < 3; i++) await cb.execute(fail);

    const result = await cb.execute(async () => ok("should not reach"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("open");
    }
  });

  it("transitions to half-open after timeout", async () => {
    const shortCb = createCircuitBreaker({
      name: "short-timeout",
      failureThreshold: 1,
      timeoutMs: 10,
    });

    await shortCb.execute(async () => err(new Error("fail")));
    expect(shortCb.getState()).toBe("open");

    // Wait for timeout + backoff
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(shortCb.getState()).toBe("half-open");
  });

  it("closes on successful call in half-open state", async () => {
    const shortCb = createCircuitBreaker({
      name: "recovery",
      failureThreshold: 1,
      timeoutMs: 10,
    });

    await shortCb.execute(async () => err(new Error("fail")));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const result = await shortCb.execute(async () => ok("recovered"));
    expect(result.ok).toBe(true);
    expect(shortCb.getState()).toBe("closed");
  });

  it("re-opens on failure in half-open state", async () => {
    const shortCb = createCircuitBreaker({
      name: "re-open",
      failureThreshold: 1,
      timeoutMs: 10,
    });

    await shortCb.execute(async () => err(new Error("fail")));
    await new Promise((resolve) => setTimeout(resolve, 50));

    await shortCb.execute(async () => err(new Error("fail again")));
    expect(shortCb.getState()).toBe("open");
  });

  it("resets to closed state", async () => {
    const fail = async () => err(new Error("fail"));
    for (let i = 0; i < 3; i++) await cb.execute(fail);

    expect(cb.getState()).toBe("open");
    cb.reset();
    expect(cb.getState()).toBe("closed");
  });
});

describe("calculateBackoff", () => {
  it("returns base timeout for first attempt", () => {
    const result = calculateBackoff(1, 1000);
    // Base * 2^0 = 1000, plus up to 10% jitter
    expect(result).toBeGreaterThanOrEqual(1000);
    expect(result).toBeLessThanOrEqual(1100);
  });

  it("doubles for each subsequent attempt", () => {
    const base = 1000;
    const result2 = calculateBackoff(2, base);
    const result3 = calculateBackoff(3, base);

    // 2nd attempt: ~2000ms, 3rd: ~4000ms
    expect(result2).toBeGreaterThanOrEqual(2000);
    expect(result2).toBeLessThanOrEqual(2200);
    expect(result3).toBeGreaterThanOrEqual(4000);
    expect(result3).toBeLessThanOrEqual(4400);
  });

  it("caps exponential growth at attempt 5", () => {
    const base = 1000;
    const result6 = calculateBackoff(6, base);
    const result10 = calculateBackoff(10, base);

    // Both should be capped at 2^5 = 32000 base
    expect(result6).toBeGreaterThanOrEqual(32000);
    expect(result10).toBeGreaterThanOrEqual(32000);
    expect(result10).toBeLessThanOrEqual(35200);
  });
});

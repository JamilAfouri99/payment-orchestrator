import { describe, it, expect } from "vitest";
import { createRetryStrategy } from "./retry-strategy.js";

describe("RetryStrategy — analyze", () => {
  it("returns fail action for a hard decline", () => {
    const strategy = createRetryStrategy();
    const action = strategy.analyze("fraud_suspected");

    expect(action.action).toBe("fail");
    expect(action.maxRetries).toBe(0);
  });

  it("includes the human-readable description in the fail reason", () => {
    const strategy = createRetryStrategy();
    const action = strategy.analyze("stolen_card");

    expect(action.reason).toBe("Card reported stolen");
  });

  it("returns retry_alternate for a soft decline", () => {
    const strategy = createRetryStrategy();
    const action = strategy.analyze("processor_unavailable");

    expect(action.action).toBe("retry_alternate");
    expect(action.maxRetries).toBeGreaterThan(0);
  });

  it("returns retry_alternate for the do_not_honor soft decline with maxRetries 2", () => {
    const strategy = createRetryStrategy();
    const action = strategy.analyze("do_not_honor");

    expect(action.action).toBe("retry_alternate");
    expect(action.maxRetries).toBe(2);
  });

  it("returns retry_later for a retriable decline", () => {
    const strategy = createRetryStrategy();
    const action = strategy.analyze("insufficient_funds");

    expect(action.action).toBe("retry_later");
    expect(action.maxRetries).toBeGreaterThan(0);
  });

  it("includes a delayMs when action is retry_later", () => {
    const strategy = createRetryStrategy();
    const action = strategy.analyze("insufficient_funds");

    expect(action.delayMs).toBeDefined();
    expect(action.delayMs!).toBeGreaterThan(0);
  });

  it("returns retry_alternate with maxRetries 2 for unknown decline codes", () => {
    const strategy = createRetryStrategy();
    const action = strategy.analyze("totally_unknown_code");

    expect(action.action).toBe("retry_alternate");
    expect(action.maxRetries).toBe(2);
    expect(action.reason).toContain("totally_unknown_code");
  });
});

describe("RetryStrategy — shouldRetry", () => {
  it("always returns false for hard declines regardless of attempt", () => {
    const strategy = createRetryStrategy();

    expect(strategy.shouldRetry("fraud_suspected", 0)).toBe(false);
    expect(strategy.shouldRetry("fraud_suspected", 1)).toBe(false);
  });

  it("returns true when currentAttempt is below maxRetries", () => {
    const strategy = createRetryStrategy();
    // processor_unavailable has maxRetries: 3
    expect(strategy.shouldRetry("processor_unavailable", 0)).toBe(true);
    expect(strategy.shouldRetry("processor_unavailable", 2)).toBe(true);
  });

  it("returns false when currentAttempt equals maxRetries", () => {
    const strategy = createRetryStrategy();
    // processor_unavailable has maxRetries: 3
    expect(strategy.shouldRetry("processor_unavailable", 3)).toBe(false);
  });

  it("returns false when currentAttempt exceeds maxRetries", () => {
    const strategy = createRetryStrategy();
    expect(strategy.shouldRetry("processor_unavailable", 10)).toBe(false);
  });

  it("uses maxRetries 2 for unknown codes", () => {
    const strategy = createRetryStrategy();
    expect(strategy.shouldRetry("unknown_code", 1)).toBe(true);
    expect(strategy.shouldRetry("unknown_code", 2)).toBe(false);
  });
});

describe("RetryStrategy — getSchedule", () => {
  it("returns the current attempt number", () => {
    const strategy = createRetryStrategy();
    const schedule = strategy.getSchedule("insufficient_funds", 2);

    expect(schedule.attempt).toBe(2);
  });

  it("uses same provider for retriable declines", () => {
    const strategy = createRetryStrategy();
    const schedule = strategy.getSchedule("insufficient_funds", 1);

    expect(schedule.provider).toBe("same");
  });

  it("uses alternate provider for soft declines", () => {
    const strategy = createRetryStrategy();
    const schedule = strategy.getSchedule("processor_unavailable", 1);

    expect(schedule.provider).toBe("alternate");
  });

  it("uses alternate provider for unknown decline codes", () => {
    const strategy = createRetryStrategy();
    const schedule = strategy.getSchedule("unknown_code", 1);

    expect(schedule.provider).toBe("alternate");
  });

  it("backoff delay is positive", () => {
    const strategy = createRetryStrategy();
    const schedule = strategy.getSchedule("insufficient_funds", 1);

    expect(schedule.delayMs).toBeGreaterThan(0);
  });

  it("backoff delay increases with each attempt", () => {
    const strategy = createRetryStrategy();
    // Run multiple times to account for jitter — p50 should still show growth
    const samples1 = Array.from({ length: 5 }, () => strategy.getSchedule("insufficient_funds", 1).delayMs);
    const samples2 = Array.from({ length: 5 }, () => strategy.getSchedule("insufficient_funds", 2).delayMs);

    const avg1 = samples1.reduce((s, v) => s + v, 0) / samples1.length;
    const avg2 = samples2.reduce((s, v) => s + v, 0) / samples2.length;

    expect(avg2).toBeGreaterThan(avg1);
  });

  it("backoff at attempt 3 is greater than at attempt 1", () => {
    const strategy = createRetryStrategy();
    // Base * 2^0 = 2000, Base * 2^2 = 8000; even with 10% jitter the inequality holds
    const low = strategy.getSchedule("insufficient_funds", 1).delayMs;
    const high = strategy.getSchedule("insufficient_funds", 3).delayMs;

    expect(high).toBeGreaterThan(low);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { createChaosController, type ChaosController } from "./chaos-controller.js";

describe("ChaosController", () => {
  let chaos: ChaosController;

  beforeEach(() => {
    chaos = createChaosController({
      "payment-provider": { failureRate: 0.1, latencyMs: 0 },
      "inventory-service": { failureRate: 0.05, latencyMs: 0 },
    });
  });

  it("returns configured failure rate", () => {
    expect(chaos.getFailureRate("payment-provider")).toBe(0.1);
    expect(chaos.getFailureRate("inventory-service")).toBe(0.05);
  });

  it("returns 0 for unknown services", () => {
    expect(chaos.getFailureRate("unknown")).toBe(0);
  });

  it("allows runtime failure rate updates", () => {
    chaos.setConfig("payment-provider", { failureRate: 1.0 });
    expect(chaos.getFailureRate("payment-provider")).toBe(1.0);
  });

  it("returns 0 when service is disabled", () => {
    chaos.setConfig("payment-provider", { enabled: false });
    expect(chaos.getFailureRate("payment-provider")).toBe(0);
  });

  it("resets to initial config", () => {
    chaos.setConfig("payment-provider", { failureRate: 1.0 });
    chaos.reset();
    expect(chaos.getFailureRate("payment-provider")).toBe(0.1);
  });

  it("returns all service configs", () => {
    const all = chaos.getAll();
    expect(Object.keys(all)).toHaveLength(2);
    expect(all["payment-provider"]?.failureRate).toBe(0.1);
  });

  it("shouldFail respects failure rate of 0", () => {
    chaos.setConfig("payment-provider", { failureRate: 0 });
    let failed = false;
    for (let i = 0; i < 100; i++) {
      if (chaos.shouldFail("payment-provider")) failed = true;
    }
    expect(failed).toBe(false);
  });

  it("shouldFail always fails at rate 1.0", () => {
    chaos.setConfig("payment-provider", { failureRate: 1.0 });
    expect(chaos.shouldFail("payment-provider")).toBe(true);
  });

  it("adds extra latency", () => {
    chaos.setConfig("payment-provider", { latencyMs: 100 });
    expect(chaos.getLatency("payment-provider")).toBe(100);
  });
});

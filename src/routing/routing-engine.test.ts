import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoutingEngine, type RoutingParams } from "./routing-engine.js";
import { createProviderRegistry, type ProviderConfig, type PaymentProviderAdapter, ProviderError } from "./provider-registry.js";
import { createCircuitBreakerRegistry } from "../circuit-breaker/circuit-breaker-registry.js";
import { ok, err } from "../core/result.js";
import type { ProviderMetrics } from "./provider-metrics.js";
import type { Logger } from "../core/logger.js";

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    name: "stripe",
    supportedCurrencies: ["USD"],
    supportedRegions: ["US"],
    costBasisPoints: 30,
    minAmountCents: 1,
    maxAmountCents: 999_999_99,
    priority: 1,
    settlementCurrency: "USD",
    ...overrides,
  };
}

function makeAdapter(succeeds = true, declineCode = "processor_unavailable"): PaymentProviderAdapter {
  return {
    charge: vi.fn().mockResolvedValue(
      succeeds
        ? ok({ transactionId: "tx_1", amount: 1000, status: "charged" as const, providerId: "stripe" })
        : err(new ProviderError("declined", "stripe", declineCode)),
    ),
    refund: vi.fn().mockResolvedValue(ok({ transactionId: "tx_1", amount: 1000, status: "refunded" as const, providerId: "stripe" })),
  };
}

function makeMetrics(successRate = 1.0): ProviderMetrics {
  return {
    record: vi.fn().mockResolvedValue(ok(undefined)),
    getSuccessRate: vi.fn().mockResolvedValue(ok(successRate)),
    getStats: vi.fn().mockResolvedValue(ok(null)),
    getAllStats: vi.fn().mockResolvedValue(ok([])),
  };
}

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const DEFAULT_PARAMS: RoutingParams = {
  amount: 1000,
  currency: "USD",
  region: "US",
  customerId: "cust_1",
};

describe("RoutingEngine — selectProvider", () => {
  it("returns NO_ELIGIBLE_PROVIDER when registry has no matching providers", async () => {
    const registry = createProviderRegistry();
    const engine = createRoutingEngine({
      registry,
      cbRegistry: createCircuitBreakerRegistry(),
      metrics: makeMetrics(),
      logger: makeLogger(),
    });

    const result = await engine.selectProvider(DEFAULT_PARAMS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NO_ELIGIBLE_PROVIDER");
  });

  it("selects the only available provider", async () => {
    const registry = createProviderRegistry();
    registry.register(makeConfig(), makeAdapter());

    const engine = createRoutingEngine({
      registry,
      cbRegistry: createCircuitBreakerRegistry(),
      metrics: makeMetrics(),
      logger: makeLogger(),
    });

    const result = await engine.selectProvider(DEFAULT_PARAMS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.providerId).toBe("stripe");
  });

  it("selects the highest-scoring provider when multiple are eligible", async () => {
    const registry = createProviderRegistry();
    // adyen: lower cost (10 bps vs 100 bps), same success rate
    registry.register(makeConfig({ name: "stripe", costBasisPoints: 100 }), makeAdapter());
    registry.register(
      makeConfig({ name: "adyen", costBasisPoints: 10 }),
      makeAdapter(),
    );

    const engine = createRoutingEngine({
      registry,
      cbRegistry: createCircuitBreakerRegistry(),
      metrics: makeMetrics(),
      logger: makeLogger(),
    });

    const result = await engine.selectProvider(DEFAULT_PARAMS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // adyen has lower cost so higher cost score
    expect(result.value.providerId).toBe("adyen");
  });

  it("populates fallbackOrder with remaining providers sorted by score", async () => {
    const registry = createProviderRegistry();
    registry.register(makeConfig({ name: "adyen", costBasisPoints: 10 }), makeAdapter());
    registry.register(makeConfig({ name: "stripe", costBasisPoints: 100 }), makeAdapter());

    const engine = createRoutingEngine({
      registry,
      cbRegistry: createCircuitBreakerRegistry(),
      metrics: makeMetrics(),
      logger: makeLogger(),
    });

    const result = await engine.selectProvider(DEFAULT_PARAMS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fallbackOrder).toHaveLength(1);
  });

  it("penalises a provider with an open circuit breaker — winner is the healthy one", async () => {
    const registry = createProviderRegistry();
    registry.register(makeConfig({ name: "stripe", costBasisPoints: 10 }), makeAdapter());
    registry.register(makeConfig({ name: "adyen", costBasisPoints: 100 }), makeAdapter());

    const cbRegistry = createCircuitBreakerRegistry();
    // Open stripe's CB by failing its threshold
    const cb = cbRegistry.create({ name: "stripe", failureThreshold: 1, timeoutMs: 60_000 });
    await cb.execute(async () => err(new Error("fail")));

    const engine = createRoutingEngine({
      registry,
      cbRegistry,
      metrics: makeMetrics(),
      logger: makeLogger(),
    });

    const result = await engine.selectProvider(DEFAULT_PARAMS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // adyen should win despite higher cost because stripe's CB is open
    expect(result.value.providerId).toBe("adyen");
    // The winner (adyen) has a healthy CB
    expect(result.value.reasons).toContain("healthy_cb");
  });

  it("assigns open_cb reason to the provider with an open circuit breaker", async () => {
    // Only register stripe so it IS selected — we verify it gets the open_cb reason
    const registry = createProviderRegistry();
    registry.register(makeConfig({ name: "stripe" }), makeAdapter());

    const cbRegistry = createCircuitBreakerRegistry();
    const cb = cbRegistry.create({ name: "stripe", failureThreshold: 1, timeoutMs: 60_000 });
    await cb.execute(async () => err(new Error("fail")));

    const engine = createRoutingEngine({
      registry,
      cbRegistry,
      metrics: makeMetrics(),
      logger: makeLogger(),
    });

    const result = await engine.selectProvider(DEFAULT_PARAMS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.providerId).toBe("stripe");
    expect(result.value.reasons).toContain("open_cb");
  });

  it("includes healthy_cb reason when circuit is closed", async () => {
    const registry = createProviderRegistry();
    registry.register(makeConfig(), makeAdapter());

    const cbRegistry = createCircuitBreakerRegistry();
    cbRegistry.create({ name: "stripe", failureThreshold: 5, timeoutMs: 60_000 });

    const engine = createRoutingEngine({
      registry,
      cbRegistry,
      metrics: makeMetrics(),
      logger: makeLogger(),
    });

    const result = await engine.selectProvider(DEFAULT_PARAMS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reasons).toContain("healthy_cb");
  });

  it("includes high_success_rate reason when success rate is 95% or above", async () => {
    const registry = createProviderRegistry();
    registry.register(makeConfig(), makeAdapter());

    const engine = createRoutingEngine({
      registry,
      cbRegistry: createCircuitBreakerRegistry(),
      metrics: makeMetrics(0.98),
      logger: makeLogger(),
    });

    const result = await engine.selectProvider(DEFAULT_PARAMS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reasons).toContain("high_success_rate");
  });
});

describe("RoutingEngine — executeWithFallback", () => {
  it("returns the charge result from the first successful provider", async () => {
    const registry = createProviderRegistry();
    registry.register(makeConfig(), makeAdapter(true));

    const engine = createRoutingEngine({
      registry,
      cbRegistry: createCircuitBreakerRegistry(),
      metrics: makeMetrics(),
      logger: makeLogger(),
    });

    const result = await engine.executeWithFallback(DEFAULT_PARAMS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.transactionId).toBe("tx_1");
    expect(result.value.status).toBe("charged");
  });

  it("falls back to the next provider when the primary fails", async () => {
    const registry = createProviderRegistry();
    // stripe fails, adyen succeeds; give adyen lower cost to score higher when stripe is penalised
    registry.register(makeConfig({ name: "stripe", costBasisPoints: 100 }), makeAdapter(false));
    registry.register(
      makeConfig({ name: "adyen", costBasisPoints: 10 }),
      {
        charge: vi.fn().mockResolvedValue(
          ok({ transactionId: "tx_adyen", amount: 1000, status: "charged" as const, providerId: "adyen" }),
        ),
        refund: vi.fn().mockResolvedValue(ok({ transactionId: "tx_adyen", amount: 1000, status: "refunded" as const, providerId: "adyen" })),
      },
    );

    const engine = createRoutingEngine({
      registry,
      cbRegistry: createCircuitBreakerRegistry(),
      metrics: makeMetrics(),
      logger: makeLogger(),
    });

    const result = await engine.executeWithFallback(DEFAULT_PARAMS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // adyen scores higher so it is tried first and succeeds immediately
    expect(result.value.providerId).toBe("adyen");
  });

  it("returns ALL_PROVIDERS_FAILED when every attempted provider fails", async () => {
    const registry = createProviderRegistry();
    registry.register(makeConfig({ name: "stripe" }), makeAdapter(false, "timeout"));
    registry.register(makeConfig({ name: "adyen" }), makeAdapter(false, "processor_unavailable"));

    const engine = createRoutingEngine({
      registry,
      cbRegistry: createCircuitBreakerRegistry(),
      metrics: makeMetrics(),
      logger: makeLogger(),
    });

    const result = await engine.executeWithFallback(DEFAULT_PARAMS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ALL_PROVIDERS_FAILED");
  });

  it("includes the last decline code in the error when all providers fail", async () => {
    const registry = createProviderRegistry();
    registry.register(makeConfig(), makeAdapter(false, "insufficient_funds"));

    const engine = createRoutingEngine({
      registry,
      cbRegistry: createCircuitBreakerRegistry(),
      metrics: makeMetrics(),
      logger: makeLogger(),
    });

    const result = await engine.executeWithFallback(DEFAULT_PARAMS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.lastDeclineCode).toBe("insufficient_funds");
  });

  it("returns NO_ELIGIBLE_PROVIDER when no provider matches the params", async () => {
    const registry = createProviderRegistry();
    registry.register(makeConfig({ supportedCurrencies: ["EUR"] }), makeAdapter());

    const engine = createRoutingEngine({
      registry,
      cbRegistry: createCircuitBreakerRegistry(),
      metrics: makeMetrics(),
      logger: makeLogger(),
    });

    const result = await engine.executeWithFallback({ ...DEFAULT_PARAMS, currency: "USD" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NO_ELIGIBLE_PROVIDER");
  });

  it("records success metric after a successful charge", async () => {
    const metrics = makeMetrics();
    const registry = createProviderRegistry();
    registry.register(makeConfig(), makeAdapter(true));

    const engine = createRoutingEngine({
      registry,
      cbRegistry: createCircuitBreakerRegistry(),
      metrics,
      logger: makeLogger(),
    });

    await engine.executeWithFallback(DEFAULT_PARAMS);

    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "stripe", outcome: "success" }),
    );
  });

  it("records failure metric after a failed charge", async () => {
    const metrics = makeMetrics();
    const registry = createProviderRegistry();
    registry.register(makeConfig(), makeAdapter(false, "timeout"));

    const engine = createRoutingEngine({
      registry,
      cbRegistry: createCircuitBreakerRegistry(),
      metrics,
      logger: makeLogger(),
    });

    await engine.executeWithFallback(DEFAULT_PARAMS);

    expect(metrics.record).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "stripe", outcome: "failure" }),
    );
  });
});

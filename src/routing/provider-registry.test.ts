import { describe, it, expect, beforeEach } from "vitest";
import {
  createProviderRegistry,
  type ProviderConfig,
  type PaymentProviderAdapter,
  type ProviderRegistry,
} from "./provider-registry.js";
import { ok } from "../core/result.js";

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    name: "stripe",
    supportedCurrencies: ["USD", "EUR"],
    supportedRegions: ["US", "EU"],
    costBasisPoints: 30,
    minAmountCents: 50,
    maxAmountCents: 100_000_00,
    priority: 1,
    settlementCurrency: "USD",
    ...overrides,
  };
}

function makeAdapter(): PaymentProviderAdapter {
  return {
    charge: async () => ok({ transactionId: "tx_1", amount: 1000, status: "charged", providerId: "stripe" }),
    refund: async () => ok({ transactionId: "tx_1", amount: 1000, status: "refunded", providerId: "stripe" }),
  };
}

describe("ProviderRegistry", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = createProviderRegistry();
  });

  describe("register and retrieval", () => {
    it("returns undefined for an unregistered adapter", () => {
      expect(registry.getAdapter("stripe")).toBeUndefined();
    });

    it("returns undefined for an unregistered config", () => {
      expect(registry.getConfig("stripe")).toBeUndefined();
    });

    it("returns empty array when no providers are registered", () => {
      expect(registry.getAllConfigs()).toEqual([]);
    });

    it("retrieves adapter after registering", () => {
      const adapter = makeAdapter();
      registry.register(makeConfig(), adapter);

      expect(registry.getAdapter("stripe")).toBe(adapter);
    });

    it("retrieves config after registering", () => {
      const config = makeConfig();
      registry.register(config, makeAdapter());

      expect(registry.getConfig("stripe")).toEqual(config);
    });

    it("returns all configs when multiple providers are registered", () => {
      const stripe = makeConfig({ name: "stripe" });
      const adyen = makeConfig({ name: "adyen", supportedCurrencies: ["EUR"] });

      registry.register(stripe, makeAdapter());
      registry.register(adyen, makeAdapter());

      const all = registry.getAllConfigs();
      expect(all).toHaveLength(2);
      expect(all.map((c) => c.name)).toContain("stripe");
      expect(all.map((c) => c.name)).toContain("adyen");
    });

    it("overwrites adapter and config when same name is registered twice", () => {
      const original = makeConfig({ costBasisPoints: 30 });
      const updated = makeConfig({ costBasisPoints: 25 });
      const updatedAdapter = makeAdapter();

      registry.register(original, makeAdapter());
      registry.register(updated, updatedAdapter);

      expect(registry.getConfig("stripe")!.costBasisPoints).toBe(25);
      expect(registry.getAdapter("stripe")).toBe(updatedAdapter);
      expect(registry.getAllConfigs()).toHaveLength(1);
    });
  });

  describe("getEligible", () => {
    beforeEach(() => {
      registry.register(
        makeConfig({ name: "stripe", supportedCurrencies: ["USD", "EUR"], supportedRegions: ["US", "EU"], minAmountCents: 50, maxAmountCents: 100_000 }),
        makeAdapter(),
      );
      registry.register(
        makeConfig({ name: "adyen", supportedCurrencies: ["EUR"], supportedRegions: ["EU"], minAmountCents: 100, maxAmountCents: 50_000 }),
        makeAdapter(),
      );
    });

    it("returns empty array when registry is empty", () => {
      const empty = createProviderRegistry();
      expect(empty.getEligible("USD", 1000, "US")).toEqual([]);
    });

    it("filters by currency — returns only providers supporting the currency", () => {
      const eligible = registry.getEligible("EUR", 1000, "EU");
      expect(eligible.map((c) => c.name)).toContain("stripe");
      expect(eligible.map((c) => c.name)).toContain("adyen");
    });

    it("excludes providers that do not support the requested currency", () => {
      const eligible = registry.getEligible("USD", 1000, "US");
      expect(eligible.map((c) => c.name)).toContain("stripe");
      expect(eligible.map((c) => c.name)).not.toContain("adyen");
    });

    it("filters by region — excludes providers that do not support the region", () => {
      const eligible = registry.getEligible("EUR", 1000, "US");
      expect(eligible.map((c) => c.name)).toContain("stripe");
      expect(eligible.map((c) => c.name)).not.toContain("adyen");
    });

    it("filters by amount — excludes providers where amount is below minimum", () => {
      const eligible = registry.getEligible("EUR", 10, "EU");

      // stripe min is 50, adyen min is 100; amount 10 is below both
      expect(eligible).toHaveLength(0);
    });

    it("filters by amount — excludes providers where amount exceeds maximum", () => {
      const eligible = registry.getEligible("EUR", 200_000, "EU");

      // stripe max is 100_000, adyen max is 50_000
      expect(eligible).toHaveLength(0);
    });

    it("includes a provider when amount is exactly at the minimum boundary", () => {
      const eligible = registry.getEligible("USD", 50, "US");
      expect(eligible.map((c) => c.name)).toContain("stripe");
    });

    it("includes a provider when amount is exactly at the maximum boundary", () => {
      const eligible = registry.getEligible("USD", 100_000, "US");
      expect(eligible.map((c) => c.name)).toContain("stripe");
    });

    it("returns empty when no provider matches all three filters", () => {
      const eligible = registry.getEligible("JPY", 1000, "US");
      expect(eligible).toHaveLength(0);
    });
  });
});

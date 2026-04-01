import { describe, it, expect } from "vitest";
import { createFxService } from "./fx-service.js";

describe("FxService — getRate", () => {
  it("returns a 1:1 rate with zero spread when from and to are the same currency", () => {
    const fx = createFxService();
    const result = fx.getRate("USD", "USD");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rate).toBe(1);
    expect(result.value.spreadBps).toBe(0);
  });

  it("returns a rate object for a supported USD to EUR pair", () => {
    const fx = createFxService();
    const result = fx.getRate("USD", "EUR");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fromCurrency).toBe("USD");
    expect(result.value.toCurrency).toBe("EUR");
    expect(result.value.rate).toBeCloseTo(0.92);
    expect(result.value.spreadBps).toBe(50);
  });

  it("returns PAIR_NOT_FOUND error for an unsupported currency pair", () => {
    const fx = createFxService();
    const result = fx.getRate("USD", "JPY");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PAIR_NOT_FOUND");
    expect(result.error.message).toContain("USD/JPY");
  });

  it("returns an updatedAt timestamp in ISO format", () => {
    const fx = createFxService();
    const result = fx.getRate("USD", "GBP");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => new Date(result.value.updatedAt)).not.toThrow();
    expect(result.value.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("FxService — convert", () => {
  it("returns a 1:1 conversion with zero margin when currencies are the same", () => {
    const fx = createFxService();
    const result = fx.convert(10_000, "USD", "USD");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.convertedAmount).toBe(10_000);
    expect(result.value.fxMarginCents).toBe(0);
    expect(result.value.rate).toBe(1);
    expect(result.value.spreadBps).toBe(0);
  });

  it("converts USD to EUR correctly applying the spread", () => {
    const fx = createFxService();
    // rate=0.92, spread=50bps → effectiveRate = 0.92 * (1 + 0.005) = 0.9246
    // 10000 * 0.9246 = 9246 cents
    const result = fx.convert(10_000, "USD", "EUR");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.originalAmount).toBe(10_000);
    expect(result.value.originalCurrency).toBe("USD");
    expect(result.value.settlementCurrency).toBe("EUR");
    expect(result.value.convertedAmount).toBe(9_246);
  });

  it("computes a positive fxMarginCents representing the spread cost", () => {
    const fx = createFxService();
    const result = fx.convert(10_000, "USD", "EUR");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // noSpread=9200, withSpread=9246 → margin=46
    expect(result.value.fxMarginCents).toBe(46);
  });

  it("returns PAIR_NOT_FOUND error when the currency pair has no rate", () => {
    const fx = createFxService();
    const result = fx.convert(5_000, "USD", "JPY");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PAIR_NOT_FOUND");
  });

  it("rounds converted amounts to the nearest cent", () => {
    const fx = createFxService();
    // Any amount should result in a whole-number convertedAmount
    const result = fx.convert(333, "USD", "EUR");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Number.isInteger(result.value.convertedAmount)).toBe(true);
    expect(Number.isInteger(result.value.fxMarginCents)).toBe(true);
  });

  it("handles a zero amount without throwing", () => {
    const fx = createFxService();
    const result = fx.convert(0, "USD", "EUR");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.convertedAmount).toBe(0);
    expect(result.value.fxMarginCents).toBe(0);
  });
});

describe("FxService — setRate", () => {
  it("makes a previously missing pair available after setting", () => {
    const fx = createFxService();

    const before = fx.getRate("USD", "JPY");
    expect(before.ok).toBe(false);

    fx.setRate("USD", "JPY", 150.0, 100);

    const after = fx.getRate("USD", "JPY");
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.rate).toBe(150.0);
    expect(after.value.spreadBps).toBe(100);
  });

  it("overwrites an existing rate", () => {
    const fx = createFxService();

    const before = fx.getRate("USD", "EUR");
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.value.rate).toBeCloseTo(0.92);

    fx.setRate("USD", "EUR", 0.88, 30);

    const after = fx.getRate("USD", "EUR");
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.rate).toBe(0.88);
    expect(after.value.spreadBps).toBe(30);
  });

  it("updates the updatedAt timestamp to a recent value", () => {
    const fx = createFxService();
    const beforeTs = Date.now();

    fx.setRate("USD", "EUR", 0.95, 40);

    const result = fx.getRate("USD", "EUR");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updatedTs = new Date(result.value.updatedAt).getTime();
    expect(updatedTs).toBeGreaterThanOrEqual(beforeTs);
  });

  it("affects subsequent convert calls using the new rate", () => {
    const fx = createFxService();
    fx.setRate("USD", "EUR", 1.0, 0);

    const result = fx.convert(10_000, "USD", "EUR");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.convertedAmount).toBe(10_000);
    expect(result.value.fxMarginCents).toBe(0);
  });
});

describe("FxService — getAllRates", () => {
  it("returns a non-empty list of default rates", () => {
    const fx = createFxService();
    expect(fx.getAllRates().length).toBeGreaterThan(0);
  });

  it("includes the USD/EUR pair among default rates", () => {
    const fx = createFxService();
    const rates = fx.getAllRates();
    const usdEur = rates.find((r) => r.fromCurrency === "USD" && r.toCurrency === "EUR");

    expect(usdEur).toBeDefined();
    expect(usdEur!.rate).toBeCloseTo(0.92);
  });

  it("reflects newly added rates from setRate", () => {
    const fx = createFxService();
    const countBefore = fx.getAllRates().length;

    fx.setRate("USD", "AUD", 1.55, 70);

    expect(fx.getAllRates().length).toBe(countBefore + 1);
  });
});

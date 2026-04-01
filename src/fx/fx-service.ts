import { type Result, ok, err } from "../core/result.js";
import type { Cents } from "../core/types.js";

export interface FxRate {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  spreadBps: number;
  updatedAt: string;
}

export interface FxConversion {
  originalAmount: Cents;
  originalCurrency: string;
  convertedAmount: Cents;
  settlementCurrency: string;
  rate: number;
  spreadBps: number;
  fxMarginCents: Cents;
}

export class FxError extends Error {
  constructor(
    message: string,
    public readonly code: "PAIR_NOT_FOUND" | "CONVERSION_FAILED",
  ) {
    super(message);
    this.name = "FxError";
  }
}

export interface FxService {
  getRate(from: string, to: string): Result<FxRate, FxError>;
  convert(amount: Cents, from: string, to: string): Result<FxConversion, FxError>;
  getAllRates(): FxRate[];
  setRate(from: string, to: string, rate: number, spreadBps: number): void;
}

const DEFAULT_RATES: [string, string, number, number][] = [
  ["USD", "EUR", 0.92, 50],
  ["USD", "GBP", 0.79, 60],
  ["USD", "JOD", 0.71, 80],
  ["EUR", "USD", 1.09, 50],
  ["EUR", "GBP", 0.86, 55],
  ["GBP", "USD", 1.27, 60],
  ["GBP", "EUR", 1.16, 55],
  ["JOD", "USD", 1.41, 80],
];

export function createFxService(): FxService {
  const rates = new Map<string, { rate: number; spreadBps: number; updatedAt: string }>();

  for (const [from, to, rate, spread] of DEFAULT_RATES) {
    rates.set(`${from}/${to}`, { rate, spreadBps: spread, updatedAt: new Date().toISOString() });
  }

  function pairKey(from: string, to: string): string {
    return `${from}/${to}`;
  }

  return {
    getRate(from, to) {
      if (from === to) {
        return ok({ fromCurrency: from, toCurrency: to, rate: 1, spreadBps: 0, updatedAt: new Date().toISOString() });
      }
      const entry = rates.get(pairKey(from, to));
      if (!entry) {
        return err(new FxError(`No rate for ${from}/${to}`, "PAIR_NOT_FOUND"));
      }
      return ok({
        fromCurrency: from,
        toCurrency: to,
        rate: entry.rate,
        spreadBps: entry.spreadBps,
        updatedAt: entry.updatedAt,
      });
    },

    convert(amount, from, to) {
      if (from === to) {
        return ok({
          originalAmount: amount,
          originalCurrency: from,
          convertedAmount: amount,
          settlementCurrency: to,
          rate: 1,
          spreadBps: 0,
          fxMarginCents: 0,
        });
      }

      const rateResult = this.getRate(from, to);
      if (!rateResult.ok) return rateResult;

      const { rate, spreadBps } = rateResult.value;
      const effectiveRate = rate * (1 + spreadBps / 10_000);
      const convertedAmount = Math.round(amount * effectiveRate);
      const convertedNoSpread = Math.round(amount * rate);
      const fxMarginCents = convertedAmount - convertedNoSpread;

      return ok({
        originalAmount: amount,
        originalCurrency: from,
        convertedAmount,
        settlementCurrency: to,
        rate,
        spreadBps,
        fxMarginCents,
      });
    },

    getAllRates() {
      const result: FxRate[] = [];
      for (const [key, entry] of rates) {
        const [from, to] = key.split("/") as [string, string];
        result.push({
          fromCurrency: from,
          toCurrency: to,
          rate: entry.rate,
          spreadBps: entry.spreadBps,
          updatedAt: entry.updatedAt,
        });
      }
      return result;
    },

    setRate(from, to, rate, spreadBps) {
      rates.set(pairKey(from, to), { rate, spreadBps, updatedAt: new Date().toISOString() });
    },
  };
}

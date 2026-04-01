import type { Result } from "../core/result.js";
import type { Cents } from "../core/types.js";

export interface ProviderConfig {
  name: string;
  supportedCurrencies: string[];
  supportedRegions: string[];
  costBasisPoints: number;
  minAmountCents: Cents;
  maxAmountCents: Cents;
  priority: number;
  settlementCurrency: string;
}

export interface PaymentProviderAdapter {
  charge(amount: Cents, customerId: string): Promise<Result<ChargeAdapterResult, ProviderError>>;
  refund(transactionId: string, amount: Cents): Promise<Result<RefundAdapterResult, ProviderError>>;
}

export interface ChargeAdapterResult {
  transactionId: string;
  amount: Cents;
  status: "charged";
  providerId: string;
}

export interface RefundAdapterResult {
  transactionId: string;
  amount: Cents;
  status: "refunded";
  providerId: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly declineCode: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ProviderRegistry {
  register(config: ProviderConfig, adapter: PaymentProviderAdapter): void;
  getAdapter(name: string): PaymentProviderAdapter | undefined;
  getConfig(name: string): ProviderConfig | undefined;
  getAllConfigs(): ProviderConfig[];
  getEligible(currency: string, amount: Cents, region: string): ProviderConfig[];
}

export function createProviderRegistry(): ProviderRegistry {
  const configs = new Map<string, ProviderConfig>();
  const adapters = new Map<string, PaymentProviderAdapter>();

  return {
    register(config, adapter) {
      configs.set(config.name, config);
      adapters.set(config.name, adapter);
    },

    getAdapter(name) {
      return adapters.get(name);
    },

    getConfig(name) {
      return configs.get(name);
    },

    getAllConfigs() {
      return [...configs.values()];
    },

    getEligible(currency, amount, region) {
      return [...configs.values()].filter((c) =>
        c.supportedCurrencies.includes(currency) &&
        c.supportedRegions.includes(region) &&
        amount >= c.minAmountCents &&
        amount <= c.maxAmountCents,
      );
    },
  };
}

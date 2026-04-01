import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PaymentMethodType = "card" | "bank_transfer" | "wallet" | "bnpl" | "crypto";

export interface PaymentMethodRecord {
  id: string;
  tenantId: string;
  customerId: string;
  type: PaymentMethodType;
  status: string;
  // Card
  cardBrand: string | null;
  cardLast4: string | null;
  cardExpMonth: number | null;
  cardExpYear: number | null;
  cardFunding: string | null;
  // Bank
  bankName: string | null;
  bankLast4: string | null;
  bankType: string | null;
  // Wallet
  walletProvider: string | null;
  walletEmail: string | null;
  // BNPL
  bnplProvider: string | null;
  bnplInstallments: number | null;
  // Crypto
  cryptoChain: string | null;
  cryptoCurrency: string | null;
  cryptoAddress: string | null;
  // Common
  label: string;
  isDefault: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePaymentMethodInput {
  customerId: string;
  type: PaymentMethodType;
  label?: string | undefined;
  // Card
  cardBrand?: string | undefined;
  cardLast4?: string | undefined;
  cardExpMonth?: number | undefined;
  cardExpYear?: number | undefined;
  cardFunding?: string | undefined;
  // Bank
  bankName?: string | undefined;
  bankLast4?: string | undefined;
  bankType?: string | undefined;
  // Wallet
  walletProvider?: string | undefined;
  walletEmail?: string | undefined;
  // BNPL
  bnplProvider?: string | undefined;
  // Crypto
  cryptoChain?: string | undefined;
  cryptoCurrency?: string | undefined;
  cryptoAddress?: string | undefined;
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string | undefined;
  installments?: number | undefined;
}

export interface PaymentMethodCapability {
  type: PaymentMethodType;
  subtype: string;
  currencies: string[];
  minAmount: number;
  maxAmount: number;
  countries: string[];
}

export class PaymentMethodError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "VALIDATION" | "NOT_ELIGIBLE" | "INTERNAL",
  ) {
    super(message);
    this.name = "PaymentMethodError";
  }
}

export interface PaymentMethodService {
  create(input: CreatePaymentMethodInput): Promise<Result<PaymentMethodRecord, PaymentMethodError>>;
  get(id: string): Promise<Result<PaymentMethodRecord, PaymentMethodError>>;
  listByCustomer(customerId: string): Promise<Result<PaymentMethodRecord[], PaymentMethodError>>;
  setDefault(customerId: string, id: string): Promise<Result<PaymentMethodRecord, PaymentMethodError>>;
  revoke(id: string): Promise<Result<void, PaymentMethodError>>;
  checkEligibility(type: string, amount: number, currency: string): Result<EligibilityResult, PaymentMethodError>;
  getSupportedMethods(currency: string, country?: string | undefined): PaymentMethodCapability[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const METHOD_CAPABILITIES: PaymentMethodCapability[] = [
  { type: "card", subtype: "card", currencies: ["USD", "EUR", "GBP", "AUD", "CAD", "JPY"], minAmount: 50, maxAmount: 99_999_900, countries: ["US", "EU", "GB", "AU", "CA", "JP"] },
  { type: "bank_transfer", subtype: "ach", currencies: ["USD"], minAmount: 100, maxAmount: 10_000_000, countries: ["US"] },
  { type: "bank_transfer", subtype: "sepa", currencies: ["EUR"], minAmount: 100, maxAmount: 10_000_000, countries: ["EU", "DE", "FR", "IT", "ES", "NL", "BE", "AT"] },
  { type: "bank_transfer", subtype: "wire", currencies: ["USD", "EUR", "GBP"], minAmount: 1000, maxAmount: 100_000_000, countries: ["US", "EU", "GB"] },
  { type: "wallet", subtype: "apple_pay", currencies: ["USD", "EUR", "GBP"], minAmount: 50, maxAmount: 2_500_000, countries: ["US", "EU", "GB"] },
  { type: "wallet", subtype: "google_pay", currencies: ["USD", "EUR", "GBP"], minAmount: 50, maxAmount: 2_500_000, countries: ["US", "EU", "GB"] },
  { type: "wallet", subtype: "paypal", currencies: ["USD", "EUR", "GBP"], minAmount: 100, maxAmount: 1_000_000, countries: ["US", "EU", "GB"] },
  { type: "bnpl", subtype: "klarna", currencies: ["USD", "EUR", "GBP"], minAmount: 5000, maxAmount: 100_000, countries: ["US", "EU", "GB"] },
  { type: "bnpl", subtype: "afterpay", currencies: ["USD", "AUD"], minAmount: 5000, maxAmount: 100_000, countries: ["US", "AU"] },
  { type: "bnpl", subtype: "affirm", currencies: ["USD"], minAmount: 5000, maxAmount: 500_000, countries: ["US"] },
  { type: "crypto", subtype: "BTC", currencies: ["BTC"], minAmount: 1, maxAmount: 1_000_000_000, countries: [] },
  { type: "crypto", subtype: "ETH", currencies: ["ETH"], minAmount: 1, maxAmount: 1_000_000_000, countries: [] },
  { type: "crypto", subtype: "USDC", currencies: ["USDC"], minAmount: 100, maxAmount: 5_000_000, countries: [] },
];

const VALID_TYPES: PaymentMethodType[] = ["card", "bank_transfer", "wallet", "bnpl", "crypto"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calculateInstallments(amount: number, provider: string): number {
  if (amount < 5000) return 0;
  if (amount <= 25000) return 4;
  if (amount <= 50000) return 6;
  if (amount <= 100_000) return 12;
  if (provider === "affirm" && amount <= 500_000) return 24;
  return 12;
}

function toRecord(row: Record<string, unknown>): PaymentMethodRecord {
  return {
    id: row["id"] as string,
    tenantId: row["tenantId"] as string,
    customerId: row["customerId"] as string,
    type: row["type"] as PaymentMethodType,
    status: row["status"] as string,
    cardBrand: (row["cardBrand"] as string | null) ?? null,
    cardLast4: (row["cardLast4"] as string | null) ?? null,
    cardExpMonth: (row["cardExpMonth"] as number | null) ?? null,
    cardExpYear: (row["cardExpYear"] as number | null) ?? null,
    cardFunding: (row["cardFunding"] as string | null) ?? null,
    bankName: (row["bankName"] as string | null) ?? null,
    bankLast4: (row["bankLast4"] as string | null) ?? null,
    bankType: (row["bankType"] as string | null) ?? null,
    walletProvider: (row["walletProvider"] as string | null) ?? null,
    walletEmail: (row["walletEmail"] as string | null) ?? null,
    bnplProvider: (row["bnplProvider"] as string | null) ?? null,
    bnplInstallments: (row["bnplInstallments"] as number | null) ?? null,
    cryptoChain: (row["cryptoChain"] as string | null) ?? null,
    cryptoCurrency: (row["cryptoCurrency"] as string | null) ?? null,
    cryptoAddress: (row["cryptoAddress"] as string | null) ?? null,
    label: row["label"] as string,
    isDefault: row["isDefault"] as boolean,
    metadata: (row["metadata"] as Record<string, unknown>) ?? {},
    createdAt: row["createdAt"] as Date,
    updatedAt: row["updatedAt"] as Date,
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createPaymentMethodService(
  prisma: PrismaClient,
  tenantId: string,
): PaymentMethodService {
  function checkEligibility(type: string, amount: number, currency: string): Result<EligibilityResult, PaymentMethodError> {
    const capabilities = METHOD_CAPABILITIES.filter((c) => {
      if (type === "card" || type === "bank_transfer" || type === "wallet" || type === "bnpl" || type === "crypto") {
        return c.type === type;
      }
      return c.subtype === type;
    });

    if (capabilities.length === 0) {
      return ok({ eligible: false, reason: `Unknown payment method type: ${type}` });
    }

    const matching = capabilities.find((c) => c.currencies.includes(currency) || c.countries.length === 0);
    if (!matching) {
      return ok({ eligible: false, reason: `${type} does not support currency ${currency}` });
    }

    if (amount < matching.minAmount) {
      return ok({ eligible: false, reason: `Amount below minimum ${matching.minAmount} for ${type}` });
    }

    if (amount > matching.maxAmount) {
      return ok({ eligible: false, reason: `Amount exceeds maximum ${matching.maxAmount} for ${type}` });
    }

    const result: EligibilityResult = { eligible: true };

    // BNPL: calculate installments
    if (matching.type === "bnpl") {
      result.installments = calculateInstallments(amount, matching.subtype);
    }

    return ok(result);
  }

  function getSupportedMethods(currency: string, country?: string | undefined): PaymentMethodCapability[] {
    return METHOD_CAPABILITIES.filter((c) => {
      const supportsCurrency = c.currencies.includes(currency);
      // Crypto has empty countries (available everywhere)
      const supportsCountry = c.countries.length === 0 || !country || c.countries.includes(country);
      return supportsCurrency && supportsCountry;
    });
  }

  return {
    checkEligibility,
    getSupportedMethods,

    async create(input) {
      if (!VALID_TYPES.includes(input.type)) {
        return err(new PaymentMethodError(`Invalid payment method type: ${input.type}`, "VALIDATION"));
      }

      if (!input.customerId) {
        return err(new PaymentMethodError("Customer ID is required", "VALIDATION"));
      }

      // Type-specific validation
      if (input.type === "card" && !input.cardLast4) {
        return err(new PaymentMethodError("Card last4 is required for card methods", "VALIDATION"));
      }
      if (input.type === "bank_transfer" && !input.bankType) {
        return err(new PaymentMethodError("Bank type (ach/sepa/wire) is required", "VALIDATION"));
      }
      if (input.type === "wallet" && !input.walletProvider) {
        return err(new PaymentMethodError("Wallet provider is required", "VALIDATION"));
      }
      if (input.type === "bnpl" && !input.bnplProvider) {
        return err(new PaymentMethodError("BNPL provider is required", "VALIDATION"));
      }
      if (input.type === "crypto" && !input.cryptoCurrency) {
        return err(new PaymentMethodError("Crypto currency is required", "VALIDATION"));
      }

      try {
        const id = uuid();
        const installments = input.type === "bnpl" && input.bnplProvider
          ? calculateInstallments(5000, input.bnplProvider)
          : null;

        const record = await prisma.paymentMethod.create({
          data: {
            id,
            tenantId,
            customerId: input.customerId,
            type: input.type,
            status: "active",
            cardBrand: input.cardBrand ?? null,
            cardLast4: input.cardLast4 ?? null,
            cardExpMonth: input.cardExpMonth ?? null,
            cardExpYear: input.cardExpYear ?? null,
            cardFunding: input.cardFunding ?? null,
            bankName: input.bankName ?? null,
            bankLast4: input.bankLast4 ?? null,
            bankType: input.bankType ?? null,
            walletProvider: input.walletProvider ?? null,
            walletEmail: input.walletEmail ?? null,
            bnplProvider: input.bnplProvider ?? null,
            bnplInstallments: installments,
            cryptoChain: input.cryptoChain ?? null,
            cryptoCurrency: input.cryptoCurrency ?? null,
            cryptoAddress: input.cryptoAddress ?? null,
            label: input.label ?? "",
            isDefault: false,
          },
        });

        return ok(toRecord(record as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new PaymentMethodError(
          `Failed to create payment method: ${e instanceof Error ? e.message : String(e)}`,
          "INTERNAL",
        ));
      }
    },

    async get(id) {
      try {
        const record = await prisma.paymentMethod.findFirst({
          where: { id, tenantId },
        });
        if (!record) {
          return err(new PaymentMethodError("Payment method not found", "NOT_FOUND"));
        }
        return ok(toRecord(record as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new PaymentMethodError(
          `Failed to get payment method: ${e instanceof Error ? e.message : String(e)}`,
          "INTERNAL",
        ));
      }
    },

    async listByCustomer(customerId) {
      try {
        const records = await prisma.paymentMethod.findMany({
          where: { tenantId, customerId, status: "active" },
          orderBy: { createdAt: "desc" },
        });
        return ok(records.map((r) => toRecord(r as unknown as Record<string, unknown>)));
      } catch (e) {
        return err(new PaymentMethodError(
          `Failed to list payment methods: ${e instanceof Error ? e.message : String(e)}`,
          "INTERNAL",
        ));
      }
    },

    async setDefault(customerId, id) {
      try {
        // Unset existing default
        await prisma.paymentMethod.updateMany({
          where: { tenantId, customerId, isDefault: true },
          data: { isDefault: false },
        });

        const record = await prisma.paymentMethod.update({
          where: { id },
          data: { isDefault: true },
        });

        return ok(toRecord(record as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new PaymentMethodError(
          `Failed to set default: ${e instanceof Error ? e.message : String(e)}`,
          "INTERNAL",
        ));
      }
    },

    async revoke(id) {
      try {
        const existing = await prisma.paymentMethod.findFirst({
          where: { id, tenantId },
        });
        if (!existing) {
          return err(new PaymentMethodError("Payment method not found", "NOT_FOUND"));
        }

        await prisma.paymentMethod.update({
          where: { id },
          data: { status: "revoked" },
        });

        return ok(undefined);
      } catch (e) {
        return err(new PaymentMethodError(
          `Failed to revoke payment method: ${e instanceof Error ? e.message : String(e)}`,
          "INTERNAL",
        ));
      }
    },
  };
}

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPaymentMethodService } from "./payment-method-service.js";

function createMockPrisma() {
  const records: Array<Record<string, unknown>> = [];

  return {
    _records: records,
    paymentMethod: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const record = { ...data, createdAt: now, updatedAt: now };
        records.push(record);
        return record;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return records.find((r) => r["id"] === where["id"] && r["tenantId"] === where["tenantId"]) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return records.filter((r) => {
          if (where["tenantId"] && r["tenantId"] !== where["tenantId"]) return false;
          if (where["customerId"] && r["customerId"] !== where["customerId"]) return false;
          if (where["status"] && r["status"] !== where["status"]) return false;
          if (where["type"] && r["type"] !== where["type"]) return false;
          return true;
        });
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const record = records.find((r) => r["id"] === where.id);
        if (!record) throw new Error("Not found");
        Object.assign(record, data, { updatedAt: new Date() });
        return record;
      }),
      updateMany: vi.fn().mockImplementation(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const matching = records.filter((r) => {
          if (where["tenantId"] && r["tenantId"] !== where["tenantId"]) return false;
          if (where["customerId"] && r["customerId"] !== where["customerId"]) return false;
          if (where["isDefault"] !== undefined && r["isDefault"] !== where["isDefault"]) return false;
          return true;
        });
        for (const r of matching) Object.assign(r, data);
        return { count: matching.length };
      }),
    },
  };
}

describe("PaymentMethodService", () => {
  const TENANT_ID = "tenant-pm-1";
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: ReturnType<typeof createPaymentMethodService>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = createPaymentMethodService(prisma as never, TENANT_ID);
  });

  describe("create", () => {
    it("creates a card payment method", async () => {
      const result = await service.create({
        customerId: "cust-1",
        type: "card",
        cardBrand: "visa",
        cardLast4: "4242",
        cardExpMonth: 12,
        cardExpYear: 2026,
        cardFunding: "credit",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.type).toBe("card");
      expect(result.value.cardBrand).toBe("visa");
      expect(result.value.cardLast4).toBe("4242");
      expect(result.value.status).toBe("active");
    });

    it("creates a bank transfer payment method", async () => {
      const result = await service.create({
        customerId: "cust-1",
        type: "bank_transfer",
        bankName: "Chase",
        bankLast4: "6789",
        bankType: "ach",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.type).toBe("bank_transfer");
      expect(result.value.bankType).toBe("ach");
    });

    it("creates a wallet payment method", async () => {
      const result = await service.create({
        customerId: "cust-1",
        type: "wallet",
        walletProvider: "apple_pay",
        walletEmail: "user@example.com",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.walletProvider).toBe("apple_pay");
    });

    it("creates a BNPL payment method with installments", async () => {
      const result = await service.create({
        customerId: "cust-1",
        type: "bnpl",
        bnplProvider: "klarna",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.bnplProvider).toBe("klarna");
      expect(result.value.bnplInstallments).toBe(4);
    });

    it("creates a crypto payment method", async () => {
      const result = await service.create({
        customerId: "cust-1",
        type: "crypto",
        cryptoChain: "ethereum",
        cryptoCurrency: "ETH",
        cryptoAddress: "0xabc123",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.cryptoCurrency).toBe("ETH");
    });

    it("rejects invalid type", async () => {
      const result = await service.create({
        customerId: "cust-1",
        type: "invalid" as never,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
    });

    it("rejects card without last4", async () => {
      const result = await service.create({
        customerId: "cust-1",
        type: "card",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
    });

    it("rejects bank_transfer without bankType", async () => {
      const result = await service.create({
        customerId: "cust-1",
        type: "bank_transfer",
      });
      expect(result.ok).toBe(false);
    });

    it("rejects missing customerId", async () => {
      const result = await service.create({
        customerId: "",
        type: "card",
        cardLast4: "4242",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
    });
  });

  describe("get", () => {
    it("returns a payment method by id", async () => {
      const createResult = await service.create({
        customerId: "cust-1",
        type: "card",
        cardLast4: "4242",
        cardBrand: "visa",
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await service.get(createResult.value.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe(createResult.value.id);
    });

    it("returns NOT_FOUND for missing method", async () => {
      const result = await service.get("nonexistent");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  describe("listByCustomer", () => {
    it("lists active methods for a customer", async () => {
      await service.create({ customerId: "cust-1", type: "card", cardLast4: "4242" });
      await service.create({ customerId: "cust-1", type: "wallet", walletProvider: "apple_pay" });
      await service.create({ customerId: "cust-2", type: "card", cardLast4: "1234" });

      const result = await service.listByCustomer("cust-1");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(2);
    });
  });

  describe("setDefault", () => {
    it("sets a method as default and clears others", async () => {
      const r1 = await service.create({ customerId: "cust-1", type: "card", cardLast4: "4242" });
      const r2 = await service.create({ customerId: "cust-1", type: "card", cardLast4: "1234" });
      expect(r1.ok && r2.ok).toBe(true);
      if (!r1.ok || !r2.ok) return;

      const result = await service.setDefault("cust-1", r2.value.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.isDefault).toBe(true);
    });
  });

  describe("revoke", () => {
    it("revokes a payment method", async () => {
      const createResult = await service.create({
        customerId: "cust-1",
        type: "card",
        cardLast4: "4242",
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await service.revoke(createResult.value.id);
      expect(result.ok).toBe(true);
    });

    it("returns NOT_FOUND for missing method", async () => {
      const result = await service.revoke("nonexistent");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  describe("checkEligibility", () => {
    it("allows card for USD $50", () => {
      const result = service.checkEligibility("card", 5000, "USD");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.eligible).toBe(true);
    });

    it("rejects BNPL below minimum", () => {
      const result = service.checkEligibility("bnpl", 2000, "USD");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.eligible).toBe(false);
    });

    it("returns installments for BNPL", () => {
      const result = service.checkEligibility("bnpl", 30000, "USD");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.eligible).toBe(true);
      expect(result.value.installments).toBe(6);
    });

    it("rejects unsupported currency for bank_transfer", () => {
      const result = service.checkEligibility("bank_transfer", 10000, "JPY");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.eligible).toBe(false);
    });
  });

  describe("getSupportedMethods", () => {
    it("returns USD-supported methods", () => {
      const methods = service.getSupportedMethods("USD");
      expect(methods.length).toBeGreaterThan(0);
      const types = methods.map((m) => m.type);
      expect(types).toContain("card");
      expect(types).toContain("bank_transfer");
      expect(types).toContain("wallet");
      expect(types).toContain("bnpl");
    });

    it("returns EUR-supported methods", () => {
      const methods = service.getSupportedMethods("EUR");
      const subtypes = methods.map((m) => m.subtype);
      expect(subtypes).toContain("sepa");
      expect(subtypes).not.toContain("ach");
    });

    it("filters by country when provided", () => {
      const methods = service.getSupportedMethods("USD", "AU");
      const subtypes = methods.map((m) => m.subtype);
      expect(subtypes).not.toContain("ach"); // ACH is US-only
    });
  });
});

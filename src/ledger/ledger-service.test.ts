import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createLedgerService,
  PLATFORM_FEE_BPS,
  type LedgerEntryInput,
} from "./ledger-service.js";

function createMockPrisma() {
  const accounts: Array<{
    id: string;
    tenantId: string;
    type: string;
    name: string;
    currency: string;
    isSystemAccount: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  const transactions: Array<{
    id: string;
    tenantId: string;
    type: string;
    idempotencyKey: string;
    status: string;
    description: string;
    createdAt: Date;
  }> = [];

  const entries: Array<{
    id: string;
    tenantId: string;
    transactionId: string;
    accountId: string;
    direction: string;
    amount: number;
    currency: string;
    effectiveAt: Date;
    postedAt: Date;
    metadata: Record<string, unknown>;
    createdAt: Date;
  }> = [];

  return {
    _accounts: accounts,
    _transactions: transactions,
    _entries: entries,
    ledgerAccount: {
      upsert: vi.fn().mockImplementation(async ({ where, create }: {
        where: { tenantId_name: { tenantId: string; name: string } };
        create: { id: string; tenantId: string; type: string; name: string; currency: string; isSystemAccount: boolean };
      }) => {
        const existing = accounts.find(
          (a) => a.tenantId === where.tenantId_name.tenantId && a.name === where.tenantId_name.name,
        );
        if (existing) return existing;
        const now = new Date();
        const record = { ...create, createdAt: now, updatedAt: now };
        accounts.push(record);
        return record;
      }),
      findUnique: vi.fn().mockImplementation(async ({ where }: {
        where: { tenantId_name: { tenantId: string; name: string } };
      }) => {
        return accounts.find(
          (a) => a.tenantId === where.tenantId_name.tenantId && a.name === where.tenantId_name.name,
        ) ?? null;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: {
        where: { tenantId: string; id?: string | undefined };
      }) => {
        if (where.id) return accounts.find((a) => a.tenantId === where.tenantId && a.id === where.id) ?? null;
        return accounts.find((a) => a.tenantId === where.tenantId) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: {
        where: { tenantId: string };
      }) => {
        return accounts.filter((a) => a.tenantId === where.tenantId).sort((a, b) => a.name.localeCompare(b.name));
      }),
    },
    ledgerTransaction: {
      findUnique: vi.fn().mockImplementation(async ({ where }: {
        where: { tenantId_idempotencyKey: { tenantId: string; idempotencyKey: string } };
      }) => {
        return transactions.find(
          (t) => t.tenantId === where.tenantId_idempotencyKey.tenantId &&
            t.idempotencyKey === where.tenantId_idempotencyKey.idempotencyKey,
        ) ?? null;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: {
        where: { tenantId: string; id: string };
      }) => {
        return transactions.find((t) => t.tenantId === where.tenantId && t.id === where.id) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where, take, skip }: {
        where: { tenantId: string };
        take?: number | undefined;
        skip?: number | undefined;
        orderBy?: unknown;
      }) => {
        let result = transactions
          .filter((t) => t.tenantId === where.tenantId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (skip !== undefined) result = result.slice(skip);
        if (take !== undefined) result = result.slice(0, take);
        return result;
      }),
      count: vi.fn().mockImplementation(async ({ where }: {
        where: { tenantId: string };
      }) => {
        return transactions.filter((t) => t.tenantId === where.tenantId).length;
      }),
      create: vi.fn().mockImplementation(async ({ data }: {
        data: { id: string; tenantId: string; type: string; idempotencyKey: string; status: string; description: string };
      }) => {
        const record = { ...data, createdAt: new Date() };
        transactions.push(record);
        return record;
      }),
    },
    ledgerEntry: {
      create: vi.fn().mockImplementation(async ({ data }: {
        data: {
          id: string;
          tenantId: string;
          transactionId: string;
          accountId: string;
          direction: string;
          amount: number;
          currency: string;
          effectiveAt: Date;
          postedAt: Date;
          metadata: Record<string, unknown>;
        };
      }) => {
        const record = { ...data, createdAt: new Date() };
        entries.push(record);
        return record;
      }),
      findMany: vi.fn().mockImplementation(async ({ where, orderBy }: {
        where: { tenantId: string; transactionId?: string | undefined; accountId?: string | undefined; effectiveAt?: { gte?: Date; lte?: Date } | undefined };
        orderBy?: unknown;
      }) => {
        let result = entries.filter((e) => e.tenantId === where.tenantId);
        if (where.transactionId) result = result.filter((e) => e.transactionId === where.transactionId);
        if (where.accountId) result = result.filter((e) => e.accountId === where.accountId);
        if (where.effectiveAt) {
          if (where.effectiveAt.gte) result = result.filter((e) => e.effectiveAt >= where.effectiveAt!.gte!);
          if (where.effectiveAt.lte) result = result.filter((e) => e.effectiveAt <= where.effectiveAt!.lte!);
        }
        if (orderBy) result = result.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return result;
      }),
    },
    $transaction: vi.fn().mockImplementation(async (ops: Promise<unknown>[]) => {
      const results = [];
      for (const op of ops) {
        results.push(await op);
      }
      return results;
    }),
  } as unknown as import("@prisma/client").PrismaClient & {
    _accounts: typeof accounts;
    _transactions: typeof transactions;
    _entries: typeof entries;
  };
}

describe("LedgerService", () => {
  const tenantId = "test-tenant";
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  async function setupAccounts() {
    const service = createLedgerService(prisma, tenantId);
    await service.ensureSystemAccounts();
    return service;
  }

  describe("ensureSystemAccounts", () => {
    it("creates 9 system accounts", async () => {
      const service = createLedgerService(prisma, tenantId);
      const result = await service.ensureSystemAccounts();

      expect(result.ok).toBe(true);
      expect(prisma._accounts).toHaveLength(9);

      const names = prisma._accounts.map((a) => a.name).sort();
      expect(names).toEqual([
        "bad_debt",
        "dispute_holds",
        "merchant_balance",
        "merchant_payout",
        "platform_fees",
        "provider_settlement",
        "refund_reserve",
        "settled_payouts",
        "subscription_adjustments",
      ]);
    });

    it("is idempotent — does not duplicate accounts", async () => {
      const service = createLedgerService(prisma, tenantId);
      await service.ensureSystemAccounts();
      await service.ensureSystemAccounts();

      expect(prisma._accounts).toHaveLength(9);
    });
  });

  describe("postTransaction", () => {
    it("posts a balanced debit-credit pair", async () => {
      const service = await setupAccounts();
      const providerAcct = prisma._accounts.find((a) => a.name === "provider_settlement")!;
      const merchantAcct = prisma._accounts.find((a) => a.name === "merchant_balance")!;

      const entries: LedgerEntryInput[] = [
        { accountId: providerAcct.id, direction: "debit", amount: 1000, currency: "USD", effectiveAt: new Date() },
        { accountId: merchantAcct.id, direction: "credit", amount: 1000, currency: "USD", effectiveAt: new Date() },
      ];

      const result = await service.postTransaction("payment_captured", "test:1", entries, "Test capture");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.entries).toHaveLength(2);
        expect(result.value.type).toBe("payment_captured");
        expect(result.value.status).toBe("posted");
      }
    });

    it("rejects imbalanced entries", async () => {
      const service = await setupAccounts();
      const providerAcct = prisma._accounts.find((a) => a.name === "provider_settlement")!;
      const merchantAcct = prisma._accounts.find((a) => a.name === "merchant_balance")!;

      const entries: LedgerEntryInput[] = [
        { accountId: providerAcct.id, direction: "debit", amount: 1000, currency: "USD", effectiveAt: new Date() },
        { accountId: merchantAcct.id, direction: "credit", amount: 500, currency: "USD", effectiveAt: new Date() },
      ];

      const result = await service.postTransaction("payment_captured", "test:2", entries);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("IMBALANCED");
      }
    });

    it("rejects negative amounts", async () => {
      const service = await setupAccounts();
      const providerAcct = prisma._accounts.find((a) => a.name === "provider_settlement")!;
      const merchantAcct = prisma._accounts.find((a) => a.name === "merchant_balance")!;

      const entries: LedgerEntryInput[] = [
        { accountId: providerAcct.id, direction: "debit", amount: -100, currency: "USD", effectiveAt: new Date() },
        { accountId: merchantAcct.id, direction: "credit", amount: -100, currency: "USD", effectiveAt: new Date() },
      ];

      const result = await service.postTransaction("payment_captured", "test:3", entries);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_ENTRY");
      }
    });

    it("rejects single-entry transactions", async () => {
      const service = await setupAccounts();
      const providerAcct = prisma._accounts.find((a) => a.name === "provider_settlement")!;

      const entries: LedgerEntryInput[] = [
        { accountId: providerAcct.id, direction: "debit", amount: 1000, currency: "USD", effectiveAt: new Date() },
      ];

      const result = await service.postTransaction("payment_captured", "test:4", entries);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Even though debits != credits (1000 != 0), it could also hit INVALID_ENTRY for < 2 entries
        expect(["IMBALANCED", "INVALID_ENTRY"]).toContain(result.error.code);
      }
    });

    it("returns existing transaction for duplicate idempotency key", async () => {
      const service = await setupAccounts();
      const providerAcct = prisma._accounts.find((a) => a.name === "provider_settlement")!;
      const merchantAcct = prisma._accounts.find((a) => a.name === "merchant_balance")!;

      const entries: LedgerEntryInput[] = [
        { accountId: providerAcct.id, direction: "debit", amount: 1000, currency: "USD", effectiveAt: new Date() },
        { accountId: merchantAcct.id, direction: "credit", amount: 1000, currency: "USD", effectiveAt: new Date() },
      ];

      const first = await service.postTransaction("payment_captured", "idem:1", entries);
      const second = await service.postTransaction("payment_captured", "idem:1", entries);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(first.value.id).toBe(second.value.id);
      }
      // Only 2 entries total (not 4)
      expect(prisma._entries).toHaveLength(2);
    });
  });

  describe("postPaymentCaptured", () => {
    it("creates 3 entries: debit provider, credit merchant, credit fees", async () => {
      const service = await setupAccounts();
      const result = await service.postPaymentCaptured("pay_123", 10000, "USD");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.entries).toHaveLength(3);
        expect(result.value.type).toBe("payment_captured");

        const debits = result.value.entries.filter((e) => e.direction === "debit");
        const credits = result.value.entries.filter((e) => e.direction === "credit");

        expect(debits).toHaveLength(1);
        expect(credits).toHaveLength(2);

        // $100.00 payment = $97.00 merchant + $3.00 fees
        expect(debits[0]!.amount).toBe(10000);

        const merchantCredit = credits.find((e) => e.amount === 9700);
        const feeCredit = credits.find((e) => e.amount === 300);
        expect(merchantCredit).toBeDefined();
        expect(feeCredit).toBeDefined();
      }
    });

    it("calculates fee correctly for odd amounts", async () => {
      const service = await setupAccounts();
      // $33.33 = 3333 cents, fee = round(3333 * 300 / 10000) = round(99.99) = 100 cents
      const result = await service.postPaymentCaptured("pay_odd", 3333, "USD");

      expect(result.ok).toBe(true);
      if (result.ok) {
        const feeAmount = Math.round((3333 * PLATFORM_FEE_BPS) / 10_000);
        expect(feeAmount).toBe(100);

        const credits = result.value.entries.filter((e) => e.direction === "credit");
        const totalCredits = credits.reduce((sum, e) => sum + e.amount, 0);
        expect(totalCredits).toBe(3333); // debits == credits
      }
    });
  });

  describe("postRefund", () => {
    it("creates 4 entries when fees are refunded", async () => {
      const service = await setupAccounts();
      // First capture so accounts have data
      await service.postPaymentCaptured("pay_ref1", 10000, "USD");

      const result = await service.postRefund("pay_ref1", 10000, "USD", true);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.entries).toHaveLength(4);
        expect(result.value.type).toBe("refund");

        const debits = result.value.entries.filter((e) => e.direction === "debit");
        const credits = result.value.entries.filter((e) => e.direction === "credit");
        const totalDebits = debits.reduce((sum, e) => sum + e.amount, 0);
        const totalCredits = credits.reduce((sum, e) => sum + e.amount, 0);

        expect(totalDebits).toBe(totalCredits);
        expect(totalDebits).toBe(10000);
      }
    });

    it("creates 2 entries when fees are not refunded", async () => {
      const service = await setupAccounts();
      await service.postPaymentCaptured("pay_ref2", 10000, "USD");

      const result = await service.postRefund("pay_ref2", 10000, "USD", false);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.entries).toHaveLength(2);
        // Merchant loses full amount minus fee that was kept
        const merchantDebit = result.value.entries.find((e) => e.direction === "debit")!;
        expect(merchantDebit.amount).toBe(10000); // full amount since no fees refunded
      }
    });
  });

  describe("getBalance", () => {
    it("computes balance from entries", async () => {
      const service = await setupAccounts();
      await service.postPaymentCaptured("pay_bal1", 10000, "USD");

      const providerAcct = prisma._accounts.find((a) => a.name === "provider_settlement")!;
      const result = await service.getBalance(providerAcct.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Asset account: debit-positive. $100 debit = $100 balance
        expect(result.value.balance).toBe(10000);
        expect(result.value.accountName).toBe("provider_settlement");
      }
    });

    it("computes liability balance as credit-positive", async () => {
      const service = await setupAccounts();
      await service.postPaymentCaptured("pay_bal2", 10000, "USD");

      const merchantAcct = prisma._accounts.find((a) => a.name === "merchant_balance")!;
      const result = await service.getBalance(merchantAcct.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Liability account: credit-positive. $97 credit = $97 balance
        expect(result.value.balance).toBe(9700);
      }
    });

    it("computes revenue balance as credit-positive", async () => {
      const service = await setupAccounts();
      await service.postPaymentCaptured("pay_bal3", 10000, "USD");

      const feesAcct = prisma._accounts.find((a) => a.name === "platform_fees")!;
      const result = await service.getBalance(feesAcct.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.balance).toBe(300);
      }
    });

    it("returns error for non-existent account", async () => {
      const service = await setupAccounts();
      const result = await service.getBalance("non-existent-id");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });
  });

  describe("getStatement", () => {
    it("returns entries in date range", async () => {
      const service = await setupAccounts();
      await service.postPaymentCaptured("pay_stmt1", 5000, "USD");

      const providerAcct = prisma._accounts.find((a) => a.name === "provider_settlement")!;
      const from = new Date(Date.now() - 86_400_000);
      const to = new Date(Date.now() + 86_400_000);
      const result = await service.getStatement(providerAcct.id, from, to);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
        expect(result.value[0]!.accountId).toBe(providerAcct.id);
      }
    });
  });

  describe("reconcile", () => {
    it("passes when all entries are balanced", async () => {
      const service = await setupAccounts();
      await service.postPaymentCaptured("pay_rec1", 10000, "USD");
      await service.postPaymentCaptured("pay_rec2", 5000, "USD");

      const result = await service.reconcile();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.passed).toBe(true);
        expect(result.value.discrepancy).toBe(0);
        expect(result.value.orphanedEntries).toBe(0);
        expect(result.value.invalidTransactions).toBe(0);
        expect(result.value.totalDebits).toBe(result.value.totalCredits);
      }
    });

    it("passes with zero entries", async () => {
      const service = await setupAccounts();
      const result = await service.reconcile();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.passed).toBe(true);
        expect(result.value.totalDebits).toBe(0);
        expect(result.value.totalCredits).toBe(0);
      }
    });
  });

  describe("listAccounts", () => {
    it("returns all accounts for tenant", async () => {
      const service = await setupAccounts();
      const result = await service.listAccounts();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(9);
        expect(result.value.every((a) => a.isSystemAccount)).toBe(true);
      }
    });
  });

  describe("getTransaction", () => {
    it("returns transaction with entries", async () => {
      const service = await setupAccounts();
      const posted = await service.postPaymentCaptured("pay_tx1", 10000, "USD");
      expect(posted.ok).toBe(true);

      if (posted.ok) {
        const result = await service.getTransaction(posted.value.id);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.entries).toHaveLength(3);
          expect(result.value.type).toBe("payment_captured");
        }
      }
    });

    it("returns error for non-existent transaction", async () => {
      const service = await setupAccounts();
      const result = await service.getTransaction("non-existent");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });
  });

  describe("listTransactions", () => {
    it("returns paginated transactions", async () => {
      const service = await setupAccounts();
      await service.postPaymentCaptured("pay_list1", 1000, "USD");
      await service.postPaymentCaptured("pay_list2", 2000, "USD");
      await service.postPaymentCaptured("pay_list3", 3000, "USD");

      const result = await service.listTransactions(2, 0);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.transactions).toHaveLength(2);
        expect(result.value.total).toBe(3);
      }
    });
  });
});

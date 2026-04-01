import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSettlementService } from "./settlement-service.js";
import {
  createLedgerService,
  type LedgerService,
  type LedgerEntryInput,
} from "../ledger/ledger-service.js";

// Reuse the same mock prisma pattern used in ledger tests, but extended for settlements
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

  const ledgerEntries: Array<{
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

  const settlements: Array<{
    id: string;
    tenantId: string;
    merchantAccountId: string;
    periodStart: Date;
    periodEnd: Date;
    status: string;
    grossAmount: number;
    totalFees: number;
    totalRefunds: number;
    totalChargebacks: number;
    netAmount: number;
    currency: string;
    payoutMethod: string;
    scheduledAt: Date | null;
    settledAt: Date | null;
    ledgerTransactionId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  return {
    _accounts: accounts,
    _transactions: transactions,
    _entries: ledgerEntries,
    _settlements: settlements,
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
        ledgerEntries.push(record);
        return record;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: {
        where: { tenantId: string; transactionId?: string | undefined; accountId?: string | undefined; effectiveAt?: { gte?: Date; lte?: Date } | undefined };
        orderBy?: unknown;
      }) => {
        let result = ledgerEntries.filter((e) => e.tenantId === where.tenantId);
        if (where.transactionId) result = result.filter((e) => e.transactionId === where.transactionId);
        if (where.accountId) result = result.filter((e) => e.accountId === where.accountId);
        if (where.effectiveAt) {
          if (where.effectiveAt.gte) result = result.filter((e) => e.effectiveAt >= where.effectiveAt!.gte!);
          if (where.effectiveAt.lte) result = result.filter((e) => e.effectiveAt <= where.effectiveAt!.lte!);
        }
        return result.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }),
    },
    settlement: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const record = {
          ...data,
          scheduledAt: (data["scheduledAt"] as Date | null) ?? null,
          settledAt: (data["settledAt"] as Date | null) ?? null,
          ledgerTransactionId: (data["ledgerTransactionId"] as string | null) ?? null,
          createdAt: now,
          updatedAt: now,
        };
        settlements.push(record as (typeof settlements)[number]);
        return record;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: {
        where: { tenantId: string; id: string };
      }) => {
        return settlements.find((s) => s.tenantId === where.tenantId && s.id === where.id) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where, take, skip }: {
        where: { tenantId: string };
        take?: number | undefined;
        skip?: number | undefined;
        orderBy?: unknown;
      }) => {
        let result = settlements
          .filter((s) => s.tenantId === where.tenantId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (skip !== undefined) result = result.slice(skip);
        if (take !== undefined) result = result.slice(0, take);
        return result;
      }),
      count: vi.fn().mockImplementation(async ({ where }: {
        where: { tenantId: string };
      }) => {
        return settlements.filter((s) => s.tenantId === where.tenantId).length;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const idx = settlements.findIndex((s) => s.id === where.id);
        if (idx === -1) throw new Error("Settlement not found");
        const updated = { ...settlements[idx]!, ...data, updatedAt: new Date() };
        settlements[idx] = updated as (typeof settlements)[number];
        return updated;
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
    _entries: typeof ledgerEntries;
    _settlements: typeof settlements;
  };
}

describe("SettlementService", () => {
  const tenantId = "test-tenant";
  const merchantAccountId = "merch_001";
  let prisma: ReturnType<typeof createMockPrisma>;
  let ledger: LedgerService;

  beforeEach(async () => {
    prisma = createMockPrisma();
    ledger = createLedgerService(prisma, tenantId);
    await ledger.ensureSystemAccounts();
  });

  describe("calculateSettlement", () => {
    it("aggregates captured payments into a settlement", async () => {
      // Post two payment captures
      await ledger.postPaymentCaptured("pay_1", 10000, "USD");
      await ledger.postPaymentCaptured("pay_2", 5000, "USD");

      const service = createSettlementService(prisma, tenantId, ledger);
      const from = new Date(Date.now() - 86_400_000);
      const to = new Date(Date.now() + 86_400_000);

      const result = await service.calculateSettlement(merchantAccountId, from, to);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("pending_approval");
        expect(result.value.grossAmount).toBe(14550); // 9700 + 4850 (merchant amounts)
        expect(result.value.totalFees).toBe(450); // 300 + 150 (fee amounts)
        expect(result.value.netAmount).toBe(14550); // gross minus refunds (0)
        expect(result.value.merchantAccountId).toBe(merchantAccountId);
      }
    });

    it("accounts for refunds in settlement", async () => {
      await ledger.postPaymentCaptured("pay_3", 10000, "USD");
      await ledger.postRefund("pay_3", 10000, "USD", true);

      const service = createSettlementService(prisma, tenantId, ledger);
      const from = new Date(Date.now() - 86_400_000);
      const to = new Date(Date.now() + 86_400_000);

      const result = await service.calculateSettlement(merchantAccountId, from, to);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Gross = 9700 (merchant credit from capture)
        // Refund debit = 9700 (merchant balance debited for refund)
        expect(result.value.totalRefunds).toBe(9700);
        expect(result.value.netAmount).toBe(0);
      }
    });
  });

  describe("approveSettlement", () => {
    it("transitions from pending_approval to approved", async () => {
      await ledger.postPaymentCaptured("pay_4", 10000, "USD");

      const service = createSettlementService(prisma, tenantId, ledger);
      const from = new Date(Date.now() - 86_400_000);
      const to = new Date(Date.now() + 86_400_000);
      const calc = await service.calculateSettlement(merchantAccountId, from, to);
      expect(calc.ok).toBe(true);

      if (calc.ok) {
        const result = await service.approveSettlement(calc.value.id);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.status).toBe("approved");
        }
      }
    });

    it("rejects approval of non-pending settlement", async () => {
      await ledger.postPaymentCaptured("pay_5", 10000, "USD");

      const service = createSettlementService(prisma, tenantId, ledger);
      const from = new Date(Date.now() - 86_400_000);
      const to = new Date(Date.now() + 86_400_000);
      const calc = await service.calculateSettlement(merchantAccountId, from, to);
      expect(calc.ok).toBe(true);

      if (calc.ok) {
        await service.approveSettlement(calc.value.id);
        // Try to approve again — should fail
        const result = await service.approveSettlement(calc.value.id);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("INVALID_STATUS");
        }
      }
    });
  });

  describe("processSettlement", () => {
    it("creates ledger entries and marks as settled", async () => {
      await ledger.postPaymentCaptured("pay_6", 10000, "USD");

      const service = createSettlementService(prisma, tenantId, ledger);
      const from = new Date(Date.now() - 86_400_000);
      const to = new Date(Date.now() + 86_400_000);
      const calc = await service.calculateSettlement(merchantAccountId, from, to);
      expect(calc.ok).toBe(true);

      if (calc.ok) {
        await service.approveSettlement(calc.value.id);
        const result = await service.processSettlement(calc.value.id);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.status).toBe("settled");
          expect(result.value.settledAt).toBeTruthy();
          expect(result.value.ledgerTransactionId).toBeTruthy();
        }
      }
    });

    it("rejects processing of non-approved settlement", async () => {
      await ledger.postPaymentCaptured("pay_7", 10000, "USD");

      const service = createSettlementService(prisma, tenantId, ledger);
      const from = new Date(Date.now() - 86_400_000);
      const to = new Date(Date.now() + 86_400_000);
      const calc = await service.calculateSettlement(merchantAccountId, from, to);
      expect(calc.ok).toBe(true);

      if (calc.ok) {
        // Skip approval — try to process directly
        const result = await service.processSettlement(calc.value.id);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("INVALID_STATUS");
        }
      }
    });
  });

  describe("generateReport", () => {
    it("returns a report with line items and summary", async () => {
      await ledger.postPaymentCaptured("pay_8", 10000, "USD");
      await ledger.postPaymentCaptured("pay_9", 5000, "USD");

      const service = createSettlementService(prisma, tenantId, ledger);
      const from = new Date(Date.now() - 86_400_000);
      const to = new Date(Date.now() + 86_400_000);
      const calc = await service.calculateSettlement(merchantAccountId, from, to);
      expect(calc.ok).toBe(true);

      if (calc.ok) {
        const result = await service.generateReport(calc.value.id);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.settlement.id).toBe(calc.value.id);
          expect(result.value.lineItems.length).toBeGreaterThan(0);
          expect(result.value.summary.grossAmount).toBe(calc.value.grossAmount);
        }
      }
    });
  });

  describe("exportCsv", () => {
    it("generates valid CSV", async () => {
      await ledger.postPaymentCaptured("pay_csv", 10000, "USD");

      const service = createSettlementService(prisma, tenantId, ledger);
      const from = new Date(Date.now() - 86_400_000);
      const to = new Date(Date.now() + 86_400_000);
      const calc = await service.calculateSettlement(merchantAccountId, from, to);
      expect(calc.ok).toBe(true);

      if (calc.ok) {
        const result = await service.exportCsv(calc.value.id);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toContain("Settlement Report");
          expect(result.value).toContain("Type,Payment ID,Amount,Currency,Date");
          expect(result.value).toContain("Summary");
        }
      }
    });
  });

  describe("listSettlements", () => {
    it("returns paginated settlements", async () => {
      await ledger.postPaymentCaptured("pay_ls1", 1000, "USD");
      await ledger.postPaymentCaptured("pay_ls2", 2000, "USD");

      const service = createSettlementService(prisma, tenantId, ledger);
      const from = new Date(Date.now() - 86_400_000);
      const to = new Date(Date.now() + 86_400_000);

      await service.calculateSettlement(merchantAccountId, from, to);
      await service.calculateSettlement("merch_002", from, to);

      const result = await service.listSettlements(10, 0);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.total).toBe(2);
        expect(result.value.settlements).toHaveLength(2);
      }
    });
  });

  describe("getSettlement", () => {
    it("returns a settlement by id", async () => {
      await ledger.postPaymentCaptured("pay_gs1", 1000, "USD");

      const service = createSettlementService(prisma, tenantId, ledger);
      const from = new Date(Date.now() - 86_400_000);
      const to = new Date(Date.now() + 86_400_000);
      const calc = await service.calculateSettlement(merchantAccountId, from, to);
      expect(calc.ok).toBe(true);

      if (calc.ok) {
        const result = await service.getSettlement(calc.value.id);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.id).toBe(calc.value.id);
        }
      }
    });

    it("returns error for non-existent settlement", async () => {
      const service = createSettlementService(prisma, tenantId, ledger);
      const result = await service.getSettlement("non-existent");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });
  });
});

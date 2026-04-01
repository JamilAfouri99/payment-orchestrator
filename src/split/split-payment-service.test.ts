import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSplitPaymentService, type SplitInput } from "./split-payment-service.js";

function createMockPrisma() {
  const splits: Array<{
    id: string;
    tenantId: string;
    paymentId: string;
    recipientType: string;
    recipientId: string;
    amount: number;
    currency: string;
    splitType: string;
    description: string;
    status: string;
    ledgerTxId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  return {
    _splits: splits,
    paymentSplit: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const record = { ...data, createdAt: now, updatedAt: now } as (typeof splits)[number];
        splits.push(record);
        return record;
      }),
      findMany: vi.fn().mockImplementation(async ({ where, orderBy: _orderBy }: {
        where: { tenantId: string; paymentId?: string | undefined };
        orderBy?: unknown;
      }) => {
        return splits.filter((s) =>
          s.tenantId === where.tenantId &&
          (!where.paymentId || s.paymentId === where.paymentId),
        );
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const split = splits.find((s) => s.id === where.id);
        if (!split) throw new Error("Not found");
        Object.assign(split, data, { updatedAt: new Date() });
        return split;
      }),
      deleteMany: vi.fn().mockImplementation(async ({ where }: {
        where: { tenantId: string; paymentId: string; status: string };
      }) => {
        const indices = splits
          .map((s, i) => (s.tenantId === where.tenantId && s.paymentId === where.paymentId && s.status === where.status ? i : -1))
          .filter((i) => i >= 0)
          .reverse();
        for (const i of indices) splits.splice(i, 1);
        return { count: indices.length };
      }),
    },
  };
}

function createMockEventStore() {
  const events: Array<Record<string, unknown>> = [];
  return {
    _events: events,
    append: vi.fn().mockImplementation(async (event: Record<string, unknown>) => {
      events.push({ ...event, id: `evt-${events.length}`, createdAt: new Date() });
      return { ok: true, value: events[events.length - 1] };
    }),
    getByAggregateId: vi.fn().mockImplementation(async (aggregateId: string) => {
      return { ok: true, value: events.filter((e) => e.aggregateId === aggregateId) };
    }),
  };
}

function createMockLedgerService() {
  let callCount = 0;
  return {
    _callCount: () => callCount,
    postTransactionByName: vi.fn().mockImplementation(async (
      _type: string,
      _key: string,
      _entries: unknown[],
      _desc?: string,
    ) => {
      callCount++;
      return { ok: true, value: { id: `ltx-${callCount}`, entries: [] } };
    }),
  };
}

function createMockWebhookService() {
  const dispatched: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  return {
    _dispatched: dispatched,
    dispatch: vi.fn().mockImplementation(async (eventType: string, payload: Record<string, unknown>) => {
      dispatched.push({ eventType, payload });
      return { ok: true, value: undefined };
    }),
  };
}

const TENANT_ID = "tenant-split-test";

describe("SplitPaymentService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let eventStore: ReturnType<typeof createMockEventStore>;
  let ledgerService: ReturnType<typeof createMockLedgerService>;
  let webhookService: ReturnType<typeof createMockWebhookService>;
  let service: ReturnType<typeof createSplitPaymentService>;

  beforeEach(() => {
    prisma = createMockPrisma();
    eventStore = createMockEventStore();
    ledgerService = createMockLedgerService();
    webhookService = createMockWebhookService();
    service = createSplitPaymentService(
      prisma as unknown as Parameters<typeof createSplitPaymentService>[0],
      TENANT_ID,
      ledgerService as unknown as Parameters<typeof createSplitPaymentService>[2],
      eventStore as unknown as Parameters<typeof createSplitPaymentService>[3],
      webhookService as unknown as Parameters<typeof createSplitPaymentService>[4],
    );
  });

  describe("validateSplits", () => {
    it("rejects fewer than 2 splits", () => {
      const result = service.validateSplits(1000, [
        { recipientType: "merchant", recipientId: "m1", amount: 1000 },
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    });

    it("rejects invalid recipientType", () => {
      const result = service.validateSplits(1000, [
        { recipientType: "invalid" as "merchant", recipientId: "m1", amount: 900 },
        { recipientType: "platform", recipientId: "p1", amount: 100 },
      ]);
      expect(result.ok).toBe(false);
    });

    it("rejects missing recipientId", () => {
      const result = service.validateSplits(1000, [
        { recipientType: "merchant", recipientId: "", amount: 900 },
        { recipientType: "platform", recipientId: "p1", amount: 100 },
      ]);
      expect(result.ok).toBe(false);
    });

    it("rejects zero or negative amounts", () => {
      const result = service.validateSplits(1000, [
        { recipientType: "merchant", recipientId: "m1", amount: 0 },
        { recipientType: "platform", recipientId: "p1", amount: 1000 },
      ]);
      expect(result.ok).toBe(false);
    });

    it("rejects splits that do not sum to payment total", () => {
      const result = service.validateSplits(1000, [
        { recipientType: "merchant", recipientId: "m1", amount: 800 },
        { recipientType: "platform", recipientId: "p1", amount: 100 },
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain("must equal payment total");
    });

    it("accepts valid splits that sum to total", () => {
      const result = service.validateSplits(1000, [
        { recipientType: "merchant", recipientId: "m1", amount: 900 },
        { recipientType: "platform", recipientId: "p1", amount: 100 },
      ]);
      expect(result.ok).toBe(true);
    });
  });

  describe("configureSplits", () => {
    const validSplits: SplitInput[] = [
      { recipientType: "merchant", recipientId: "seller-1", amount: 9000, description: "Seller share" },
      { recipientType: "platform", recipientId: "platform", amount: 1000, description: "Platform fee" },
    ];

    it("creates splits for a payment", async () => {
      const result = await service.configureSplits("pay-1", 10000, validSplits);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      expect(result.value[0]!.recipientType).toBe("merchant");
      expect(result.value[0]!.amount).toBe(9000);
      expect(result.value[1]!.recipientType).toBe("platform");
      expect(result.value[1]!.amount).toBe(1000);
    });

    it("appends SplitsConfigured event", async () => {
      await service.configureSplits("pay-1", 10000, validSplits);
      expect(eventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "SplitsConfigured", aggregateId: "pay-1" }),
      );
    });

    it("dispatches split.configured webhook", async () => {
      await service.configureSplits("pay-1", 10000, validSplits);
      expect(webhookService.dispatch).toHaveBeenCalledWith(
        "split.configured",
        expect.objectContaining({ paymentId: "pay-1" }),
      );
    });

    it("rejects invalid splits", async () => {
      const result = await service.configureSplits("pay-1", 10000, [
        { recipientType: "merchant", recipientId: "m1", amount: 5000 },
      ]);
      expect(result.ok).toBe(false);
    });

    it("rejects reconfiguration after execution", async () => {
      await service.configureSplits("pay-1", 10000, validSplits);
      // Simulate execution
      prisma._splits.forEach((s) => { s.status = "executed"; });

      const result = await service.configureSplits("pay-1", 10000, validSplits);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_STATUS");
    });

    it("allows reconfiguration of pending splits", async () => {
      await service.configureSplits("pay-1", 10000, validSplits);
      expect(prisma._splits).toHaveLength(2);

      const newSplits: SplitInput[] = [
        { recipientType: "merchant", recipientId: "seller-1", amount: 8000 },
        { recipientType: "merchant", recipientId: "affiliate", amount: 1000 },
        { recipientType: "platform", recipientId: "platform", amount: 1000 },
      ];
      const result = await service.configureSplits("pay-1", 10000, newSplits);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(3);
    });
  });

  describe("executeSplits", () => {
    const validSplits: SplitInput[] = [
      { recipientType: "merchant", recipientId: "seller-1", amount: 9000 },
      { recipientType: "platform", recipientId: "platform", amount: 1000 },
    ];

    it("executes all splits with ledger entries", async () => {
      await service.configureSplits("pay-1", 10000, validSplits);
      const result = await service.executeSplits("pay-1");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      expect(result.value.every((s) => s.status === "executed")).toBe(true);
      expect(ledgerService.postTransactionByName).toHaveBeenCalledTimes(2);
    });

    it("credits merchant_balance for merchant splits", async () => {
      await service.configureSplits("pay-1", 10000, validSplits);
      await service.executeSplits("pay-1");

      const merchantCall = ledgerService.postTransactionByName.mock.calls[0]!;
      const entries = merchantCall[2] as Array<{ accountName: string; direction: string }>;
      expect(entries[0]!.accountName).toBe("provider_settlement");
      expect(entries[0]!.direction).toBe("debit");
      expect(entries[1]!.accountName).toBe("merchant_balance");
      expect(entries[1]!.direction).toBe("credit");
    });

    it("credits platform_fees for platform splits", async () => {
      await service.configureSplits("pay-1", 10000, validSplits);
      await service.executeSplits("pay-1");

      const platformCall = ledgerService.postTransactionByName.mock.calls[1]!;
      const entries = platformCall[2] as Array<{ accountName: string; direction: string }>;
      expect(entries[1]!.accountName).toBe("platform_fees");
      expect(entries[1]!.direction).toBe("credit");
    });

    it("appends SplitsExecuted event", async () => {
      await service.configureSplits("pay-1", 10000, validSplits);
      await service.executeSplits("pay-1");
      expect(eventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "SplitsExecuted" }),
      );
    });

    it("dispatches split.executed webhook", async () => {
      await service.configureSplits("pay-1", 10000, validSplits);
      await service.executeSplits("pay-1");
      expect(webhookService.dispatch).toHaveBeenCalledWith(
        "split.executed",
        expect.objectContaining({ paymentId: "pay-1" }),
      );
    });

    it("returns NOT_FOUND for missing splits", async () => {
      const result = await service.executeSplits("nonexistent");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    });

    it("rejects double execution", async () => {
      await service.configureSplits("pay-1", 10000, validSplits);
      await service.executeSplits("pay-1");

      const result = await service.executeSplits("pay-1");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_STATUS");
    });
  });

  describe("getSplits", () => {
    it("returns splits for a payment", async () => {
      await service.configureSplits("pay-1", 10000, [
        { recipientType: "merchant", recipientId: "s1", amount: 9000 },
        { recipientType: "platform", recipientId: "p1", amount: 1000 },
      ]);

      const result = await service.getSplits("pay-1");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(2);
    });

    it("returns empty array for payment with no splits", async () => {
      const result = await service.getSplits("no-splits");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(0);
    });
  });

  describe("multi-vendor cart scenario", () => {
    it("splits to multiple sellers + platform", async () => {
      const splits: SplitInput[] = [
        { recipientType: "merchant", recipientId: "seller-a", amount: 5000, description: "Seller A items" },
        { recipientType: "merchant", recipientId: "seller-b", amount: 3000, description: "Seller B items" },
        { recipientType: "third_party", recipientId: "affiliate", amount: 500, description: "Affiliate commission" },
        { recipientType: "platform", recipientId: "platform", amount: 1500, description: "Platform fee" },
      ];

      const configResult = await service.configureSplits("pay-cart", 10000, splits);
      expect(configResult.ok).toBe(true);

      const execResult = await service.executeSplits("pay-cart");
      expect(execResult.ok).toBe(true);
      if (!execResult.ok) return;
      expect(execResult.value).toHaveLength(4);
      expect(execResult.value.every((s) => s.status === "executed")).toBe(true);
      expect(ledgerService.postTransactionByName).toHaveBeenCalledTimes(4);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPayoutService, type PayoutAccountInput, type SchedulePayoutInput } from "./payout-service.js";

function createMockPrisma() {
  const payoutAccounts: Array<Record<string, unknown>> = [];
  const payouts: Array<Record<string, unknown>> = [];

  return {
    _payoutAccounts: payoutAccounts,
    _payouts: payouts,
    payoutAccount: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const record = { ...data, createdAt: now, updatedAt: now };
        payoutAccounts.push(record);
        return record;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return payoutAccounts.find((a) => {
          for (const [key, value] of Object.entries(where)) {
            if ((a as Record<string, unknown>)[key] !== value) return false;
          }
          return true;
        }) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return payoutAccounts.filter((a) => {
          for (const [key, value] of Object.entries(where)) {
            if ((a as Record<string, unknown>)[key] !== value) return false;
          }
          return true;
        });
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const account = payoutAccounts.find((a) => a.id === where.id);
        if (!account) throw new Error("Not found");
        Object.assign(account, data, { updatedAt: new Date() });
        return account;
      }),
      updateMany: vi.fn().mockImplementation(async ({ where, data }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const a of payoutAccounts) {
          let match = true;
          for (const [key, value] of Object.entries(where)) {
            if ((a as Record<string, unknown>)[key] !== value) { match = false; break; }
          }
          if (match) { Object.assign(a, data); count++; }
        }
        return { count };
      }),
    },
    payout: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const record = { ...data, createdAt: now, updatedAt: now, retryCount: data.retryCount ?? 0, fees: data.fees ?? 0 };
        payouts.push(record);
        return record;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return payouts.find((p) => {
          for (const [key, value] of Object.entries(where)) {
            if ((p as Record<string, unknown>)[key] !== value) return false;
          }
          return true;
        }) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where, take: _take, skip: _skip }: {
        where: Record<string, unknown>;
        orderBy?: unknown;
        take?: number;
        skip?: number;
      }) => {
        return payouts.filter((p) => {
          for (const [key, value] of Object.entries(where)) {
            if ((p as Record<string, unknown>)[key] !== value) return false;
          }
          return true;
        });
      }),
      count: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return payouts.filter((p) => {
          for (const [key, value] of Object.entries(where)) {
            if ((p as Record<string, unknown>)[key] !== value) return false;
          }
          return true;
        }).length;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const payout = payouts.find((p) => p.id === where.id);
        if (!payout) throw new Error("Not found");
        Object.assign(payout, data, { updatedAt: new Date() });
        return payout;
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
  return {
    postTransactionByName: vi.fn().mockImplementation(async () => {
      return { ok: true, value: { id: `ltx-${Date.now()}`, entries: [] } };
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

const TENANT_ID = "tenant-payout-test";

describe("PayoutService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let eventStore: ReturnType<typeof createMockEventStore>;
  let ledgerService: ReturnType<typeof createMockLedgerService>;
  let webhookService: ReturnType<typeof createMockWebhookService>;
  let service: ReturnType<typeof createPayoutService>;

  beforeEach(() => {
    prisma = createMockPrisma();
    eventStore = createMockEventStore();
    ledgerService = createMockLedgerService();
    webhookService = createMockWebhookService();
    service = createPayoutService(
      prisma as unknown as Parameters<typeof createPayoutService>[0],
      TENANT_ID,
      ledgerService as unknown as Parameters<typeof createPayoutService>[2],
      eventStore as unknown as Parameters<typeof createPayoutService>[3],
      webhookService as unknown as Parameters<typeof createPayoutService>[4],
    );
  });

  describe("Payout Accounts", () => {
    const validInput: PayoutAccountInput = {
      merchantAccountId: "merch-1",
      bankName: "Chase Bank",
      accountNumberLast4: "4567",
      routingNumber: "021000021",
    };

    it("creates a payout account with masked numbers", async () => {
      const result = await service.createPayoutAccount(validInput);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.bankName).toBe("Chase Bank");
      expect(result.value.accountNumberMasked).toBe("****4567");
      expect(result.value.routingNumber).toBe("****0021");
      expect(result.value.status).toBe("pending_verification");
      expect(result.value.isDefault).toBe(false);
    });

    it("rejects missing merchantAccountId", async () => {
      const result = await service.createPayoutAccount({ ...validInput, merchantAccountId: "" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    });

    it("rejects invalid last4 length", async () => {
      const result = await service.createPayoutAccount({ ...validInput, accountNumberLast4: "12" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    });

    it("verifies a pending account", async () => {
      const created = await service.createPayoutAccount(validInput);
      if (!created.ok) return;

      const result = await service.verifyPayoutAccount(created.value.id);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.status).toBe("verified");
    });

    it("rejects verifying an already verified account", async () => {
      const created = await service.createPayoutAccount(validInput);
      if (!created.ok) return;
      await service.verifyPayoutAccount(created.value.id);

      const result = await service.verifyPayoutAccount(created.value.id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_STATUS");
    });

    it("disables an account", async () => {
      const created = await service.createPayoutAccount(validInput);
      if (!created.ok) return;

      const result = await service.disablePayoutAccount(created.value.id);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.status).toBe("disabled");
    });

    it("sets default account (must be verified)", async () => {
      const created = await service.createPayoutAccount(validInput);
      if (!created.ok) return;
      await service.verifyPayoutAccount(created.value.id);

      const result = await service.setDefaultPayoutAccount(created.value.id);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.isDefault).toBe(true);
    });

    it("rejects setting unverified account as default", async () => {
      const created = await service.createPayoutAccount(validInput);
      if (!created.ok) return;

      const result = await service.setDefaultPayoutAccount(created.value.id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_STATUS");
    });

    it("lists payout accounts filtered by merchant", async () => {
      await service.createPayoutAccount(validInput);
      await service.createPayoutAccount({ ...validInput, merchantAccountId: "merch-2", bankName: "BOA" });

      const result = await service.listPayoutAccounts("merch-1");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(1);
    });

    it("returns NOT_FOUND for missing account", async () => {
      const result = await service.getPayoutAccount("nonexistent");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  describe("Payouts", () => {
    async function setupVerifiedAccount(): Promise<string> {
      const created = await service.createPayoutAccount({
        merchantAccountId: "merch-1",
        bankName: "Chase",
        accountNumberLast4: "4567",
        routingNumber: "021000021",
      });
      if (!created.ok) throw new Error("Setup failed");
      await service.verifyPayoutAccount(created.value.id);
      await service.setDefaultPayoutAccount(created.value.id);
      return created.value.id;
    }

    it("schedules a payout using default account", async () => {
      await setupVerifiedAccount();

      const result = await service.schedulePayout({
        merchantAccountId: "merch-1",
        amount: 50000,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("pending");
      expect(result.value.amount).toBe(50000);
    });

    it("schedules a payout with explicit account", async () => {
      const accountId = await setupVerifiedAccount();

      const result = await service.schedulePayout({
        merchantAccountId: "merch-1",
        amount: 50000,
        payoutAccountId: accountId,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.payoutAccountId).toBe(accountId);
    });

    it("appends PayoutScheduled event", async () => {
      await setupVerifiedAccount();
      await service.schedulePayout({ merchantAccountId: "merch-1", amount: 50000 });

      expect(eventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "PayoutScheduled" }),
      );
    });

    it("dispatches payout.scheduled webhook", async () => {
      await setupVerifiedAccount();
      await service.schedulePayout({ merchantAccountId: "merch-1", amount: 50000 });

      expect(webhookService.dispatch).toHaveBeenCalledWith(
        "payout.scheduled",
        expect.objectContaining({ amount: 50000 }),
      );
    });

    it("rejects payout with no verified account", async () => {
      const result = await service.schedulePayout({
        merchantAccountId: "merch-1",
        amount: 50000,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    });

    it("rejects zero amount", async () => {
      const result = await service.schedulePayout({
        merchantAccountId: "merch-1",
        amount: 0,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    });

    it("processes a pending payout with ledger entries", async () => {
      await setupVerifiedAccount();
      const scheduled = await service.schedulePayout({ merchantAccountId: "merch-1", amount: 50000 });
      if (!scheduled.ok) return;

      const result = await service.processPayout(scheduled.value.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("in_transit");
      expect(result.value.ledgerTransactionId).toBeTruthy();

      // Verify ledger entries: debit merchant_balance, credit merchant_payout
      expect(ledgerService.postTransactionByName).toHaveBeenCalledWith(
        "settlement",
        expect.stringContaining("payout:"),
        expect.arrayContaining([
          expect.objectContaining({ accountName: "merchant_balance", direction: "debit" }),
          expect.objectContaining({ accountName: "merchant_payout", direction: "credit" }),
        ]),
        expect.any(String),
      );
    });

    it("appends PayoutInTransit event on process", async () => {
      await setupVerifiedAccount();
      const scheduled = await service.schedulePayout({ merchantAccountId: "merch-1", amount: 50000 });
      if (!scheduled.ok) return;

      await service.processPayout(scheduled.value.id);
      expect(eventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "PayoutInTransit" }),
      );
    });

    it("rejects processing a non-pending payout", async () => {
      await setupVerifiedAccount();
      const scheduled = await service.schedulePayout({ merchantAccountId: "merch-1", amount: 50000 });
      if (!scheduled.ok) return;

      // Process once
      await service.processPayout(scheduled.value.id);

      // Try again
      const result = await service.processPayout(scheduled.value.id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_STATUS");
    });

    it("cancels a pending payout", async () => {
      await setupVerifiedAccount();
      const scheduled = await service.schedulePayout({ merchantAccountId: "merch-1", amount: 50000 });
      if (!scheduled.ok) return;

      const result = await service.cancelPayout(scheduled.value.id);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.status).toBe("canceled");
    });

    it("dispatches payout.canceled webhook", async () => {
      await setupVerifiedAccount();
      const scheduled = await service.schedulePayout({ merchantAccountId: "merch-1", amount: 50000 });
      if (!scheduled.ok) return;

      await service.cancelPayout(scheduled.value.id);
      expect(webhookService.dispatch).toHaveBeenCalledWith(
        "payout.canceled",
        expect.objectContaining({ payoutId: scheduled.value.id }),
      );
    });

    it("rejects canceling non-pending payout", async () => {
      await setupVerifiedAccount();
      const scheduled = await service.schedulePayout({ merchantAccountId: "merch-1", amount: 50000 });
      if (!scheduled.ok) return;
      await service.processPayout(scheduled.value.id);

      const result = await service.cancelPayout(scheduled.value.id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_STATUS");
    });

    it("returns NOT_FOUND for missing payout", async () => {
      const result = await service.getPayout("nonexistent");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    });

    it("lists payouts with filters", async () => {
      await setupVerifiedAccount();
      await service.schedulePayout({ merchantAccountId: "merch-1", amount: 50000 });
      await service.schedulePayout({ merchantAccountId: "merch-1", amount: 30000 });

      const result = await service.listPayouts({ merchantAccountId: "merch-1" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.payouts).toHaveLength(2);
        expect(result.value.total).toBe(2);
      }
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDunningService, type DunningService, DEFAULT_MAX_RETRY_ATTEMPTS, DEFAULT_RETRY_SCHEDULE_DAYS } from "./dunning-service.js";

function createMockPrisma() {
  const invoices: Record<string, unknown>[] = [];
  const dunningConfigs: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];

  return {
    _invoices: invoices,
    _dunningConfigs: dunningConfigs,
    _events: events,
    invoice: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        return invoices.find((i) => i["id"] === where.id) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return invoices.filter((i) => {
          if (i["tenantId"] !== where["tenantId"]) return false;
          if (where["status"] !== undefined && i["status"] !== where["status"]) return false;
          const dateFilter = where["nextAttemptAt"] as { lte?: Date } | undefined;
          if (dateFilter?.lte && (!i["nextAttemptAt"] || (i["nextAttemptAt"] as Date) > dateFilter.lte)) return false;
          return true;
        });
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = invoices.findIndex((i) => i["id"] === where.id);
        if (idx >= 0) {
          invoices[idx] = { ...invoices[idx]!, ...data };
          return invoices[idx]!;
        }
        throw new Error("Not found");
      }),
    },
    dunningConfig: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { tenantId: string } }) => {
        return dunningConfigs.find((c) => c["tenantId"] === where.tenantId) ?? null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        dunningConfigs.push(data);
        return data;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: { where: { tenantId: string }; data: Record<string, unknown> }) => {
        const idx = dunningConfigs.findIndex((c) => c["tenantId"] === where.tenantId);
        if (idx >= 0) {
          dunningConfigs[idx] = { ...dunningConfigs[idx]!, ...data };
          return dunningConfigs[idx]!;
        }
        throw new Error("Not found");
      }),
    },
    eventStore: {
      findMany: vi.fn().mockImplementation(async () => events),
    },
  };
}

function createMockEventStore() {
  return {
    append: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    getByAggregateId: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    getByAggregateIdAt: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    getAfterVersion: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    replay: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    replayAt: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    listAggregates: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    countAggregates: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
  };
}

function createMockBillingEngine() {
  return {
    attemptPayment: vi.fn().mockResolvedValue({ ok: false, error: { code: "PAYMENT_FAILED" } }),
    generateInvoice: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    processDueSubscriptions: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    getInvoice: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    listInvoices: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    voidInvoice: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    markUncollectible: vi.fn().mockResolvedValue({ ok: true, value: {} }),
  };
}

function createMockSubscriptionService() {
  return {
    markPastDue: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    cancel: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    pause: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    activate: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    get: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    create: vi.fn(),
    upgrade: vi.fn(),
    downgrade: vi.fn(),
    resume: vi.fn(),
    list: vi.fn(),
    createPlan: vi.fn(),
    getPlan: vi.fn(),
    listPlans: vi.fn(),
    archivePlan: vi.fn(),
    getUpcomingInvoice: vi.fn(),
    getEvents: vi.fn(),
    calculateProration: vi.fn(),
  };
}

const TENANT_ID = "tenant_test";

describe("DunningService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let eventStore: ReturnType<typeof createMockEventStore>;
  let billingEngine: ReturnType<typeof createMockBillingEngine>;
  let subscriptionService: ReturnType<typeof createMockSubscriptionService>;
  let service: DunningService;

  beforeEach(() => {
    prisma = createMockPrisma();
    eventStore = createMockEventStore();
    billingEngine = createMockBillingEngine();
    subscriptionService = createMockSubscriptionService();
    service = createDunningService(
      prisma as unknown as import("@prisma/client").PrismaClient,
      TENANT_ID,
      billingEngine as unknown as import("./billing-engine.js").BillingEngine,
      subscriptionService as unknown as import("../subscription/subscription-service.js").SubscriptionService,
      eventStore as unknown as import("../events/event-store.js").EventStore,
    );
  });

  describe("Config", () => {
    it("creates default config on first access", async () => {
      const result = await service.getConfig();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.maxRetryAttempts).toBe(DEFAULT_MAX_RETRY_ATTEMPTS);
        expect(result.value.retryScheduleDays).toEqual(DEFAULT_RETRY_SCHEDULE_DAYS);
        expect(result.value.onFirstFailure).toBe("email_customer");
        expect(result.value.onFinalFailure).toBe("cancel_subscription");
        expect(result.value.gracePeriodDays).toBe(7);
      }
    });

    it("returns existing config", async () => {
      prisma._dunningConfigs.push({
        id: "dc_1",
        tenantId: TENANT_ID,
        maxRetryAttempts: 6,
        retryScheduleDays: [1, 2, 3, 5, 8, 13],
        onFirstFailure: "none",
        onEachRetry: "email_customer",
        onFinalFailure: "pause_subscription",
        gracePeriodDays: 14,
      });

      const result = await service.getConfig();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.maxRetryAttempts).toBe(6);
        expect(result.value.onFinalFailure).toBe("pause_subscription");
      }
    });

    it("updates config", async () => {
      await service.getConfig();
      const result = await service.updateConfig({ maxRetryAttempts: 8 });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.maxRetryAttempts).toBe(8);
    });
  });

  describe("startDunning", () => {
    it("starts dunning flow for a failed invoice", async () => {
      prisma._invoices.push({
        id: "inv_1", tenantId: TENANT_ID, subscriptionId: "sub_1",
        status: "past_due", total: 2999, currency: "USD", attemptCount: 1,
      });

      const result = await service.startDunning("inv_1");
      expect(result.ok).toBe(true);

      // Should mark subscription as past_due
      expect(subscriptionService.markPastDue).toHaveBeenCalledWith("sub_1");

      // Should schedule retry
      expect(prisma.invoice.update).toHaveBeenCalled();

      // Should log dunning event
      expect(eventStore.append).toHaveBeenCalled();
    });

    it("returns NOT_FOUND for missing invoice", async () => {
      const result = await service.startDunning("nonexistent");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  describe("getActiveDunningFlows", () => {
    it("returns past_due invoices as active flows", async () => {
      prisma._invoices.push(
        {
          id: "inv_1", tenantId: TENANT_ID, subscriptionId: "sub_1",
          customerId: "cust_1", status: "past_due", total: 2999,
          currency: "USD", attemptCount: 2, nextAttemptAt: new Date(),
          createdAt: new Date(),
        },
        {
          id: "inv_2", tenantId: TENANT_ID, subscriptionId: "sub_2",
          customerId: "cust_2", status: "past_due", total: 999,
          currency: "USD", attemptCount: 1, nextAttemptAt: new Date(),
          createdAt: new Date(),
        },
      );

      const result = await service.getActiveDunningFlows();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(2);
        expect(result.value[0]!.invoiceId).toBe("inv_1");
        expect(result.value[0]!.status).toBe("active");
      }
    });
  });

  describe("getRetryAnalytics", () => {
    it("computes recovery rates from events", async () => {
      const now = new Date();
      prisma._events.push(
        { eventType: "DunningRetryAttempted", payload: { result: "recovered" }, createdAt: now, tenantId: TENANT_ID },
        { eventType: "DunningRetryAttempted", payload: { result: "failed" }, createdAt: now, tenantId: TENANT_ID },
        { eventType: "DunningRetryAttempted", payload: { result: "recovered" }, createdAt: now, tenantId: TENANT_ID },
        { eventType: "InvoicePaymentAttempted", payload: { succeeded: true }, createdAt: now, tenantId: TENANT_ID },
      );

      const result = await service.getRetryAnalytics();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.totalAttempts).toBe(4);
        expect(result.value.totalRecovered).toBe(3);
        expect(result.value.recoveryRate).toBe(75);
        expect(result.value.byHourOfDay).toHaveLength(24);
        expect(result.value.byDayOfWeek).toHaveLength(7);
      }
    });

    it("returns zero rates with no events", async () => {
      const result = await service.getRetryAnalytics();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.totalAttempts).toBe(0);
        expect(result.value.recoveryRate).toBe(0);
      }
    });
  });

  describe("scheduleSmartRetry", () => {
    it("schedules retry at optimal hour", async () => {
      prisma._invoices.push({
        id: "inv_1", tenantId: TENANT_ID, status: "past_due",
      });

      const result = await service.scheduleSmartRetry("inv_1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeInstanceOf(Date);
        expect(result.value.getTime()).toBeGreaterThan(Date.now());
      }
    });
  });

  describe("processRetries", () => {
    it("processes due retries", async () => {
      const pastDate = new Date(Date.now() - 86_400_000);
      prisma._invoices.push({
        id: "inv_1", tenantId: TENANT_ID, subscriptionId: "sub_1",
        status: "past_due", total: 2999, currency: "USD",
        attemptCount: 1, nextAttemptAt: pastDate,
      });

      const result = await service.processRetries();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.processed).toBe(1);
      }
    });

    it("returns zero counts with no due invoices", async () => {
      const result = await service.processRetries();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.processed).toBe(0);
        expect(result.value.recovered).toBe(0);
        expect(result.value.failed).toBe(0);
      }
    });
  });
});

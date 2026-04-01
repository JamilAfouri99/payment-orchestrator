import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSubscriptionService, type Plan, type Subscription, type SubscriptionService } from "./subscription-service.js";

function createMockPrisma() {
  const plans: Record<string, unknown>[] = [];
  const subscriptions: Record<string, unknown>[] = [];

  return {
    _plans: plans,
    _subscriptions: subscriptions,
    plan: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        plans.push(data);
        return data;
      }),
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        return plans.find((p) => p["id"] === where.id) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return plans.filter((p) => p["tenantId"] === where["tenantId"] && p["status"] === (where["status"] ?? p["status"]));
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = plans.findIndex((p) => p["id"] === where.id);
        if (idx >= 0) {
          plans[idx] = { ...plans[idx]!, ...data };
          return plans[idx]!;
        }
        throw new Error("Not found");
      }),
    },
    subscription: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, createdAt: new Date(), updatedAt: new Date() };
        subscriptions.push(row);
        return row;
      }),
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        return subscriptions.find((s) => s["id"] === where.id) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return subscriptions.filter((s) => {
          if (s["tenantId"] !== where["tenantId"]) return false;
          if (where["status"] !== undefined && s["status"] !== where["status"]) return false;
          return true;
        });
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = subscriptions.findIndex((s) => s["id"] === where.id);
        if (idx >= 0) {
          subscriptions[idx] = { ...subscriptions[idx]!, ...data, updatedAt: new Date() };
          return subscriptions[idx]!;
        }
        throw new Error("Not found");
      }),
    },
  };
}

function createMockEventStore() {
  const events: Record<string, unknown>[] = [];
  return {
    _events: events,
    append: vi.fn().mockImplementation(async (event: Record<string, unknown>) => {
      events.push({ id: `evt_${events.length}`, ...event, createdAt: new Date() });
      return { ok: true, value: events[events.length - 1] };
    }),
    getByAggregateId: vi.fn().mockImplementation(async (id: string) => {
      return { ok: true, value: events.filter((e) => e["aggregateId"] === id) };
    }),
    getByAggregateIdAt: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    getAfterVersion: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    replay: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    replayAt: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    listAggregates: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    countAggregates: vi.fn().mockResolvedValue({ ok: true, value: 0 }),
  };
}

function createMockLedgerService() {
  return {
    ensureSystemAccounts: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    getAccount: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    postTransaction: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    postTransactionByName: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    getBalance: vi.fn().mockResolvedValue({ ok: true, value: { balance: 0 } }),
    getStatement: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    reconcile: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    postPaymentCaptured: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    postRefund: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    listAccounts: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    getTransaction: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    listTransactions: vi.fn().mockResolvedValue({ ok: true, value: { transactions: [], total: 0 } }),
  };
}

const TENANT_ID = "tenant_test";

describe("SubscriptionService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let eventStore: ReturnType<typeof createMockEventStore>;
  let ledgerService: ReturnType<typeof createMockLedgerService>;
  let service: SubscriptionService;

  beforeEach(() => {
    prisma = createMockPrisma();
    eventStore = createMockEventStore();
    ledgerService = createMockLedgerService();
    service = createSubscriptionService(
      prisma as unknown as import("@prisma/client").PrismaClient,
      TENANT_ID,
      eventStore as unknown as import("../events/event-store.js").EventStore,
      ledgerService as unknown as import("../ledger/ledger-service.js").LedgerService,
    );
  });

  describe("Plan CRUD", () => {
    it("creates a plan", async () => {
      const result = await service.createPlan({
        name: "Pro",
        billingInterval: "monthly",
        amount: 2999,
        currency: "USD",
        trialDays: 14,
        features: ["feature_a", "feature_b"],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("Pro");
        expect(result.value.amount).toBe(2999);
        expect(result.value.trialDays).toBe(14);
        expect(result.value.billingInterval).toBe("monthly");
      }
    });

    it("rejects plan with zero amount", async () => {
      const result = await service.createPlan({ name: "Free", billingInterval: "monthly", amount: 0 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    });

    it("rejects plan with empty name", async () => {
      const result = await service.createPlan({ name: "  ", billingInterval: "monthly", amount: 1000 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    });

    it("lists active plans", async () => {
      await service.createPlan({ name: "Basic", billingInterval: "monthly", amount: 999 });
      await service.createPlan({ name: "Pro", billingInterval: "monthly", amount: 2999 });
      const result = await service.listPlans();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.length).toBe(2);
    });

    it("archives a plan", async () => {
      const create = await service.createPlan({ name: "Basic", billingInterval: "monthly", amount: 999 });
      expect(create.ok).toBe(true);
      if (!create.ok) return;
      const archive = await service.archivePlan(create.value.id);
      expect(archive.ok).toBe(true);
      if (archive.ok) expect(archive.value.status).toBe("archived");
    });

    it("returns NOT_FOUND for missing plan", async () => {
      const result = await service.getPlan("nonexistent");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  describe("Subscription Lifecycle", () => {
    let planId: string;

    beforeEach(async () => {
      const planResult = await service.createPlan({
        name: "Pro Monthly",
        billingInterval: "monthly",
        amount: 2999,
        trialDays: 14,
      });
      if (planResult.ok) planId = planResult.value.id;
    });

    it("creates a subscription with trial", async () => {
      const result = await service.create({
        customerId: "cust_1",
        planId,
        paymentMethodTokenId: "tok_abc",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("trialing");
        expect(result.value.trialStart).not.toBeNull();
        expect(result.value.trialEnd).not.toBeNull();
        expect(result.value.customerId).toBe("cust_1");
        expect(result.value.paymentMethodTokenId).toBe("tok_abc");
      }
    });

    it("creates a subscription without trial (trialDays=0)", async () => {
      const noTrialPlan = await service.createPlan({
        name: "No Trial",
        billingInterval: "monthly",
        amount: 1999,
        trialDays: 0,
      });
      if (!noTrialPlan.ok) return;

      const result = await service.create({
        customerId: "cust_2",
        planId: noTrialPlan.value.id,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("active");
        expect(result.value.trialStart).toBeNull();
      }
    });

    it("rejects subscription with archived plan", async () => {
      await service.archivePlan(planId);
      const result = await service.create({ customerId: "cust_1", planId });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_PLAN");
    });

    it("cancels a subscription", async () => {
      const noTrialPlan = await service.createPlan({ name: "Direct", billingInterval: "monthly", amount: 999, trialDays: 0 });
      if (!noTrialPlan.ok) return;

      const sub = await service.create({ customerId: "cust_1", planId: noTrialPlan.value.id });
      if (!sub.ok) return;

      const result = await service.cancel(sub.value.id, "Customer requested", false);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("canceled");
        expect(result.value.cancelReason).toBe("Customer requested");
      }
    });

    it("pauses and resumes a subscription", async () => {
      const noTrialPlan = await service.createPlan({ name: "Direct", billingInterval: "monthly", amount: 999, trialDays: 0 });
      if (!noTrialPlan.ok) return;

      const sub = await service.create({ customerId: "cust_1", planId: noTrialPlan.value.id });
      if (!sub.ok) return;

      const paused = await service.pause(sub.value.id);
      expect(paused.ok).toBe(true);
      if (paused.ok) expect(paused.value.status).toBe("paused");

      const resumed = await service.resume(sub.value.id);
      expect(resumed.ok).toBe(true);
      if (resumed.ok) expect(resumed.value.status).toBe("active");
    });

    it("rejects invalid state transitions", async () => {
      const noTrialPlan = await service.createPlan({ name: "Direct", billingInterval: "monthly", amount: 999, trialDays: 0 });
      if (!noTrialPlan.ok) return;

      const sub = await service.create({ customerId: "cust_1", planId: noTrialPlan.value.id });
      if (!sub.ok) return;

      // Cancel it
      await service.cancel(sub.value.id, "test", false);

      // Try to pause a canceled subscription — should fail
      const result = await service.pause(sub.value.id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_STATUS");
    });

    it("returns NOT_FOUND for missing subscription", async () => {
      const result = await service.get("nonexistent");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    });

    it("lists subscriptions with status filter", async () => {
      const noTrialPlan = await service.createPlan({ name: "Direct", billingInterval: "monthly", amount: 999, trialDays: 0 });
      if (!noTrialPlan.ok) return;

      await service.create({ customerId: "cust_1", planId: noTrialPlan.value.id });
      await service.create({ customerId: "cust_2", planId });

      const all = await service.list();
      expect(all.ok).toBe(true);
      if (all.ok) expect(all.value.length).toBe(2);

      const trialing = await service.list("trialing");
      expect(trialing.ok).toBe(true);
      if (trialing.ok) expect(trialing.value.length).toBe(1);
    });

    it("records events for subscription creation", async () => {
      await service.create({ customerId: "cust_1", planId });
      expect(eventStore.append).toHaveBeenCalled();
      const firstCall = eventStore.append.mock.calls[0]![0] as Record<string, unknown>;
      expect(firstCall["aggregateType"]).toBe("Subscription");
    });
  });

  describe("Proration", () => {
    it("calculates proration for mid-cycle upgrade", () => {
      const now = new Date();
      const periodStart = new Date(now.getTime() - 15 * 86_400_000);
      const periodEnd = new Date(now.getTime() + 15 * 86_400_000);

      const oldPlan: Plan = {
        id: "plan_old", tenantId: TENANT_ID, name: "Basic", description: "",
        billingInterval: "monthly", amount: 1000, currency: "USD", trialDays: 0,
        features: [], status: "active", metadata: {},
        createdAt: new Date(), updatedAt: new Date(),
      };
      const newPlan: Plan = {
        id: "plan_new", tenantId: TENANT_ID, name: "Pro", description: "",
        billingInterval: "monthly", amount: 3000, currency: "USD", trialDays: 0,
        features: [], status: "active", metadata: {},
        createdAt: new Date(), updatedAt: new Date(),
      };
      const sub: Subscription = {
        id: "sub_1", tenantId: TENANT_ID, customerId: "cust_1", planId: "plan_old",
        status: "active", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd,
        trialStart: null, trialEnd: null, canceledAt: null, cancelReason: null,
        paymentMethodTokenId: null, nextBillingDate: periodEnd, quantity: 1,
        metadata: {}, createdAt: new Date(), updatedAt: new Date(),
      };

      const proration = service.calculateProration(oldPlan, newPlan, sub);
      expect(proration.daysRemaining).toBeGreaterThan(0);
      expect(proration.totalDays).toBe(30);
      expect(proration.netAmount).toBeGreaterThan(0);
      expect(proration.chargeAmount).toBeGreaterThan(proration.creditAmount);
    });

    it("returns zero proration for zero-day period", () => {
      const now = new Date();
      const oldPlan: Plan = {
        id: "p1", tenantId: TENANT_ID, name: "A", description: "",
        billingInterval: "monthly", amount: 1000, currency: "USD", trialDays: 0,
        features: [], status: "active", metadata: {},
        createdAt: new Date(), updatedAt: new Date(),
      };
      const sub: Subscription = {
        id: "s1", tenantId: TENANT_ID, customerId: "c1", planId: "p1",
        status: "active", currentPeriodStart: now, currentPeriodEnd: now,
        trialStart: null, trialEnd: null, canceledAt: null, cancelReason: null,
        paymentMethodTokenId: null, nextBillingDate: now, quantity: 1,
        metadata: {}, createdAt: new Date(), updatedAt: new Date(),
      };

      const result = service.calculateProration(oldPlan, oldPlan, sub);
      expect(result.netAmount).toBe(0);
      expect(result.totalDays).toBe(0);
    });
  });

  describe("Upcoming Invoice", () => {
    it("previews the next invoice", async () => {
      const planResult = await service.createPlan({
        name: "Pro",
        billingInterval: "monthly",
        amount: 2999,
        trialDays: 0,
      });
      if (!planResult.ok) return;

      const subResult = await service.create({
        customerId: "cust_1",
        planId: planResult.value.id,
        quantity: 3,
      });
      if (!subResult.ok) return;

      const upcoming = await service.getUpcomingInvoice(subResult.value.id);
      expect(upcoming.ok).toBe(true);
      if (upcoming.ok) {
        expect(upcoming.value.amount).toBe(2999 * 3);
        expect(upcoming.value.quantity).toBe(3);
        expect(upcoming.value.planName).toBe("Pro");
      }
    });
  });
});

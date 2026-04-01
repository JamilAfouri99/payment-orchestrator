import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBillingEngine, type BillingEngine } from "./billing-engine.js";
import { PLATFORM_FEE_BPS } from "../ledger/ledger-service.js";

function createMockPrisma() {
  const plans: Record<string, unknown>[] = [];
  const subscriptions: Record<string, unknown>[] = [];
  const invoices: Record<string, unknown>[] = [];

  return {
    _plans: plans,
    _subscriptions: subscriptions,
    _invoices: invoices,
    plan: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        return plans.find((p) => p["id"] === where.id) ?? null;
      }),
    },
    subscription: {
      findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return subscriptions.filter((s) => {
          if (s["tenantId"] !== where["tenantId"]) return false;
          const statusFilter = where["status"] as { in?: string[] } | undefined;
          if (statusFilter?.in && !statusFilter.in.includes(s["status"] as string)) return false;
          const dateFilter = where["nextBillingDate"] as { lte?: Date } | undefined;
          if (dateFilter?.lte && (s["nextBillingDate"] as Date) > dateFilter.lte) return false;
          return true;
        });
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = subscriptions.findIndex((s) => s["id"] === where.id);
        if (idx >= 0) {
          subscriptions[idx] = { ...subscriptions[idx]!, ...data };
          return subscriptions[idx]!;
        }
        throw new Error("Not found");
      }),
    },
    invoice: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, createdAt: new Date(), updatedAt: new Date() };
        invoices.push(row);
        return row;
      }),
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        return invoices.find((i) => i["id"] === where.id) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return invoices.filter((i) => {
          if (i["tenantId"] !== where["tenantId"]) return false;
          if (where["status"] !== undefined && i["status"] !== where["status"]) return false;
          if (where["subscriptionId"] !== undefined && i["subscriptionId"] !== where["subscriptionId"]) return false;
          return true;
        });
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = invoices.findIndex((i) => i["id"] === where.id);
        if (idx >= 0) {
          invoices[idx] = { ...invoices[idx]!, ...data, updatedAt: new Date() };
          return invoices[idx]!;
        }
        throw new Error("Not found");
      }),
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

function createMockSubscriptionService() {
  return {
    get: vi.fn().mockResolvedValue({ ok: true, value: { id: "sub_1", planId: "plan_1", status: "active", metadata: {} } }),
    activate: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    markPastDue: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    create: vi.fn(),
    cancel: vi.fn(),
    upgrade: vi.fn(),
    downgrade: vi.fn(),
    pause: vi.fn(),
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

describe("BillingEngine", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let eventStore: ReturnType<typeof createMockEventStore>;
  let subscriptionService: ReturnType<typeof createMockSubscriptionService>;
  let ledgerService: ReturnType<typeof createMockLedgerService>;
  let engine: BillingEngine;

  beforeEach(() => {
    prisma = createMockPrisma();
    eventStore = createMockEventStore();
    subscriptionService = createMockSubscriptionService();
    ledgerService = createMockLedgerService();
    engine = createBillingEngine(
      prisma as unknown as import("@prisma/client").PrismaClient,
      TENANT_ID,
      subscriptionService as unknown as import("../subscription/subscription-service.js").SubscriptionService,
      ledgerService as unknown as import("../ledger/ledger-service.js").LedgerService,
      eventStore as unknown as import("../events/event-store.js").EventStore,
    );
  });

  describe("generateInvoice", () => {
    it("generates an invoice for a subscription", async () => {
      prisma._plans.push({
        id: "plan_1",
        tenantId: TENANT_ID,
        name: "Pro",
        billingInterval: "monthly",
        amount: 2999,
        currency: "USD",
      });

      subscriptionService.get.mockResolvedValue({
        ok: true,
        value: {
          id: "sub_1",
          tenantId: TENANT_ID,
          customerId: "cust_1",
          planId: "plan_1",
          status: "active",
          currentPeriodEnd: new Date(),
          quantity: 1,
          metadata: {},
        },
      });

      const result = await engine.generateInvoice("sub_1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.total).toBe(2999);
        expect(result.value.status).toBe("open");
        expect(result.value.subscriptionId).toBe("sub_1");
        expect(result.value.lineItems).toHaveLength(1);
      }
    });

    it("generates invoice with quantity > 1", async () => {
      prisma._plans.push({
        id: "plan_1",
        tenantId: TENANT_ID,
        name: "Team",
        billingInterval: "monthly",
        amount: 1000,
        currency: "USD",
      });

      subscriptionService.get.mockResolvedValue({
        ok: true,
        value: {
          id: "sub_1", tenantId: TENANT_ID, customerId: "cust_1",
          planId: "plan_1", status: "active",
          currentPeriodEnd: new Date(), quantity: 5, metadata: {},
        },
      });

      const result = await engine.generateInvoice("sub_1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.total).toBe(5000);
        expect(result.value.lineItems[0]!.quantity).toBe(5);
      }
    });

    it("returns NOT_FOUND for missing subscription", async () => {
      subscriptionService.get.mockResolvedValue({
        ok: false,
        error: new Error("Not found"),
      });
      const result = await engine.generateInvoice("nonexistent");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  describe("listInvoices", () => {
    it("lists invoices with filters", async () => {
      prisma._invoices.push(
        { id: "inv_1", tenantId: TENANT_ID, status: "paid", subscriptionId: "sub_1", createdAt: new Date() },
        { id: "inv_2", tenantId: TENANT_ID, status: "open", subscriptionId: "sub_1", createdAt: new Date() },
        { id: "inv_3", tenantId: TENANT_ID, status: "paid", subscriptionId: "sub_2", createdAt: new Date() },
      );

      const all = await engine.listInvoices();
      expect(all.ok).toBe(true);
      if (all.ok) expect(all.value.length).toBe(3);

      const paid = await engine.listInvoices({ status: "paid" });
      expect(paid.ok).toBe(true);
      if (paid.ok) expect(paid.value.length).toBe(2);

      const sub1 = await engine.listInvoices({ subscriptionId: "sub_1" });
      expect(sub1.ok).toBe(true);
      if (sub1.ok) expect(sub1.value.length).toBe(2);
    });
  });

  describe("voidInvoice", () => {
    it("voids an open invoice", async () => {
      prisma._invoices.push({
        id: "inv_1", tenantId: TENANT_ID, status: "open",
        subscriptionId: "sub_1", total: 2999, createdAt: new Date(),
      });

      const result = await engine.voidInvoice("inv_1");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.status).toBe("void");
    });

    it("rejects voiding a paid invoice", async () => {
      prisma._invoices.push({
        id: "inv_1", tenantId: TENANT_ID, status: "paid",
        subscriptionId: "sub_1", total: 2999, createdAt: new Date(),
      });

      const result = await engine.voidInvoice("inv_1");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_STATUS");
    });
  });

  describe("markUncollectible", () => {
    it("marks invoice uncollectible and posts write-off", async () => {
      prisma._invoices.push({
        id: "inv_1", tenantId: TENANT_ID, status: "past_due",
        subscriptionId: "sub_1", total: 2999, currency: "USD",
        createdAt: new Date(),
      });

      const result = await engine.markUncollectible("inv_1");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.status).toBe("uncollectible");

      // Verify ledger write-off was posted
      expect(ledgerService.postTransactionByName).toHaveBeenCalledWith(
        "adjustment",
        expect.stringContaining("invoice_writeoff:inv_1"),
        expect.arrayContaining([
          expect.objectContaining({ accountName: "bad_debt", direction: "debit", amount: 2999 }),
        ]),
        expect.any(String),
      );
    });
  });

  describe("processDueSubscriptions", () => {
    it("processes billing cycle", async () => {
      const now = new Date();
      const pastDate = new Date(now.getTime() - 86_400_000);

      prisma._plans.push({
        id: "plan_1", tenantId: TENANT_ID, name: "Pro",
        billingInterval: "monthly", amount: 2999, currency: "USD",
      });

      prisma._subscriptions.push({
        id: "sub_1", tenantId: TENANT_ID, customerId: "cust_1",
        planId: "plan_1", status: "active",
        currentPeriodStart: new Date(pastDate.getTime() - 30 * 86_400_000),
        currentPeriodEnd: pastDate,
        nextBillingDate: pastDate,
        trialStart: null, trialEnd: null,
        quantity: 1, metadata: {},
        createdAt: new Date(), updatedAt: new Date(),
      });

      subscriptionService.get.mockResolvedValue({
        ok: true,
        value: {
          id: "sub_1", planId: "plan_1", status: "active",
          currentPeriodEnd: pastDate, metadata: {},
        },
      });

      const result = await engine.processDueSubscriptions();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.processed).toBe(1);
        expect(result.value.invoicesGenerated).toBe(1);
        expect(result.value.paymentSuccesses + result.value.paymentFailures).toBe(1);
      }
    });
  });

  describe("getInvoice", () => {
    it("returns invoice by id", async () => {
      prisma._invoices.push({
        id: "inv_1", tenantId: TENANT_ID, subscriptionId: "sub_1",
        customerId: "cust_1", status: "open", total: 2999, currency: "USD",
        lineItems: [], subtotal: 2999, taxAmount: 0, taxRate: 0,
        dueDate: new Date(), paidAt: null, paymentId: null,
        attemptCount: 0, nextAttemptAt: null,
        hostedInvoiceUrl: "/invoices/inv_1/view", pdfUrl: "/invoices/inv_1/pdf",
        createdAt: new Date(), updatedAt: new Date(),
      });

      const result = await engine.getInvoice("inv_1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe("inv_1");
        expect(result.value.total).toBe(2999);
      }
    });

    it("returns NOT_FOUND for missing invoice", async () => {
      const result = await engine.getInvoice("nonexistent");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCheckoutService } from "./checkout-service.js";

function createMockPrisma() {
  const sessions: Array<Record<string, unknown>> = [];

  return {
    _sessions: sessions,
    checkoutSession: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const record = { ...data, createdAt: now, updatedAt: now };
        sessions.push(record);
        return record;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return sessions.find((s) => s["id"] === where["id"] && s["tenantId"] === where["tenantId"]) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return sessions.filter((s) => {
          if (where["tenantId"] && s["tenantId"] !== where["tenantId"]) return false;
          if (where["status"] && s["status"] !== where["status"]) return false;
          return true;
        });
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const session = sessions.find((s) => s["id"] === where.id);
        if (!session) throw new Error("Not found");
        Object.assign(session, data, { updatedAt: new Date() });
        return session;
      }),
    },
  };
}

describe("CheckoutService", () => {
  const TENANT_ID = "tenant-checkout-1";
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: ReturnType<typeof createCheckoutService>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = createCheckoutService(prisma as never, TENANT_ID);
  });

  describe("createSession", () => {
    it("creates a session with defaults", async () => {
      const result = await service.createSession({ amount: 5000 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.amount).toBe(5000);
      expect(result.value.currency).toBe("USD");
      expect(result.value.status).toBe("open");
      expect(result.value.allowedPaymentMethods).toEqual(["card"]);
      expect(result.value.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("creates session with line items", async () => {
      const result = await service.createSession({
        amount: 5000,
        lineItems: [
          { name: "Widget", quantity: 2, unitPrice: 2500 },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.lineItems).toHaveLength(1);
    });

    it("rejects mismatched line items total", async () => {
      const result = await service.createSession({
        amount: 5000,
        lineItems: [
          { name: "Widget", quantity: 1, unitPrice: 3000 },
        ],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
    });

    it("rejects zero amount", async () => {
      const result = await service.createSession({ amount: 0 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
    });

    it("rejects invalid currency", async () => {
      const result = await service.createSession({ amount: 5000, currency: "XX" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
    });

    it("rejects invalid payment method", async () => {
      const result = await service.createSession({
        amount: 5000,
        allowedPaymentMethods: ["magic"],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
    });

    it("supports multiple payment methods", async () => {
      const result = await service.createSession({
        amount: 5000,
        allowedPaymentMethods: ["card", "wallet", "bnpl"],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.allowedPaymentMethods).toEqual(["card", "wallet", "bnpl"]);
    });

    it("supports custom expiry", async () => {
      const result = await service.createSession({
        amount: 5000,
        expiresInMinutes: 60,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const diff = result.value.expiresAt.getTime() - Date.now();
      expect(diff).toBeGreaterThan(55 * 60 * 1000);
      expect(diff).toBeLessThan(65 * 60 * 1000);
    });
  });

  describe("getSession", () => {
    it("returns an existing session", async () => {
      const createResult = await service.createSession({ amount: 5000 });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await service.getSession(createResult.value.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe(createResult.value.id);
    });

    it("returns NOT_FOUND for missing session", async () => {
      const result = await service.getSession("nonexistent");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("auto-expires past-due sessions", async () => {
      prisma._sessions.push({
        id: "expired-session",
        tenantId: TENANT_ID,
        amount: 5000,
        currency: "USD",
        status: "open",
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getSession("expired-session");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("expired");
    });
  });

  describe("completeSession", () => {
    it("completes an open session", async () => {
      const createResult = await service.createSession({ amount: 5000 });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await service.completeSession(createResult.value.id, "pay-1", "card");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("complete");
      expect(result.value.paymentId).toBe("pay-1");
      expect(result.value.paymentMethodType).toBe("card");
    });

    it("rejects completing already-completed session", async () => {
      const createResult = await service.createSession({ amount: 5000 });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      await service.completeSession(createResult.value.id, "pay-1", "card");
      const result = await service.completeSession(createResult.value.id, "pay-2", "card");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("ALREADY_COMPLETE");
    });

    it("rejects completing expired session", async () => {
      prisma._sessions.push({
        id: "expired-session-2",
        tenantId: TENANT_ID,
        amount: 5000,
        currency: "USD",
        status: "open",
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.completeSession("expired-session-2", "pay-1", "card");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("EXPIRED");
    });
  });

  describe("expireSession", () => {
    it("expires an open session", async () => {
      const createResult = await service.createSession({ amount: 5000 });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = await service.expireSession(createResult.value.id);
      expect(result.ok).toBe(true);
    });

    it("cannot expire a completed session", async () => {
      const createResult = await service.createSession({ amount: 5000 });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      await service.completeSession(createResult.value.id, "pay-1", "card");
      const result = await service.expireSession(createResult.value.id);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("ALREADY_COMPLETE");
    });
  });

  describe("listSessions", () => {
    it("lists all sessions", async () => {
      await service.createSession({ amount: 5000 });
      await service.createSession({ amount: 3000 });

      const result = await service.listSessions();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(2);
    });

    it("filters by status", async () => {
      await service.createSession({ amount: 5000 });
      const r2 = await service.createSession({ amount: 3000 });
      if (r2.ok) await service.completeSession(r2.value.id, "pay-1", "card");

      const result = await service.listSessions({ status: "complete" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(1);
    });
  });

  describe("getConversionStats", () => {
    it("returns empty stats for no sessions", async () => {
      const result = await service.getConversionStats();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.totalSessions).toBe(0);
      expect(result.value.conversionRate).toBe(0);
    });

    it("calculates conversion rate", async () => {
      await service.createSession({ amount: 5000 });
      const r2 = await service.createSession({ amount: 3000 });
      const r3 = await service.createSession({ amount: 2000 });

      if (r2.ok) await service.completeSession(r2.value.id, "pay-1", "card");
      if (r3.ok) await service.completeSession(r3.value.id, "pay-2", "wallet");

      const result = await service.getConversionStats();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.totalSessions).toBe(3);
      expect(result.value.completedSessions).toBe(2);
      expect(result.value.conversionRate).toBeCloseTo(66.67, 1);
      expect(result.value.byPaymentMethod["card"]!.count).toBe(1);
      expect(result.value.byPaymentMethod["wallet"]!.count).toBe(1);
    });
  });
});

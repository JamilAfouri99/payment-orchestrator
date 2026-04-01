import { describe, it, expect, vi } from "vitest";
import { createSandboxService, type TestCardBehavior } from "./sandbox-service.js";
import type { PrismaClient } from "@prisma/client";

function createMockPrisma() {
  const events: { tenantId: string; aggregateId: string }[] = [];
  const disputes: { id: string; tenantId: string; paymentId: string; status: string }[] = [];

  return {
    eventStore: {
      findMany: vi.fn().mockImplementation(async (args: { where: { tenantId: string; aggregateId: string } }) => {
        return events.filter(
          (e) => e.tenantId === args.where.tenantId && e.aggregateId === args.where.aggregateId,
        );
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: 5 }),
    },
    dispute: {
      create: vi.fn().mockImplementation(async (args: { data: { tenantId: string; paymentId: string } }) => {
        const dispute = {
          id: `dsp_mock_${disputes.length}`,
          tenantId: args.data.tenantId,
          paymentId: args.data.paymentId,
          status: "open",
        };
        disputes.push(dispute);
        return dispute;
      }),
    },
    sagaExecution: {
      deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
    },
    eventSnapshot: {
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    _addEvent(tenantId: string, aggregateId: string) {
      events.push({ tenantId, aggregateId });
    },
  } as unknown as PrismaClient & { _addEvent: (t: string, a: string) => void };
}

describe("SandboxService", () => {
  const TENANT_ID = "tenant_sandbox_test";

  describe("isTestCard", () => {
    it("recognizes all 7 test card numbers", () => {
      const prisma = createMockPrisma();
      const sandbox = createSandboxService(prisma, TENANT_ID);

      expect(sandbox.isTestCard("4242424242424242")).toBe(true);
      expect(sandbox.isTestCard("4000000000000002")).toBe(true);
      expect(sandbox.isTestCard("4000000000003220")).toBe(true);
      expect(sandbox.isTestCard("4000000000000069")).toBe(true);
      expect(sandbox.isTestCard("4000000000000127")).toBe(true);
      expect(sandbox.isTestCard("4000000000004954")).toBe(true);
      expect(sandbox.isTestCard("4000000000009995")).toBe(true);
    });

    it("returns false for non-test cards", () => {
      const prisma = createMockPrisma();
      const sandbox = createSandboxService(prisma, TENANT_ID);
      expect(sandbox.isTestCard("5555555555554444")).toBe(false);
    });

    it("strips spaces from card numbers", () => {
      const prisma = createMockPrisma();
      const sandbox = createSandboxService(prisma, TENANT_ID);
      expect(sandbox.isTestCard("4242 4242 4242 4242")).toBe(true);
    });
  });

  describe("getTestCardBehavior", () => {
    const prisma = createMockPrisma();
    const sandbox = createSandboxService(prisma, TENANT_ID);

    const expected: [string, TestCardBehavior][] = [
      ["4242424242424242", "success"],
      ["4000000000000002", "decline_insufficient_funds"],
      ["4000000000003220", "3ds_challenge"],
      ["4000000000000069", "timeout"],
      ["4000000000000127", "fraud_block"],
      ["4000000000004954", "success_then_dispute"],
      ["4000000000009995", "soft_decline_retry"],
    ];

    for (const [card, behavior] of expected) {
      it(`maps ${card} to ${behavior}`, () => {
        expect(sandbox.getTestCardBehavior(card)).toBe(behavior);
      });
    }

    it("returns null for unknown cards", () => {
      expect(sandbox.getTestCardBehavior("1234567890123456")).toBeNull();
    });
  });

  describe("simulatePayment", () => {
    const prisma = createMockPrisma();
    const sandbox = createSandboxService(prisma, TENANT_ID);

    it("success card returns succeeded", () => {
      const result = sandbox.simulatePayment("4242424242424242", 5000);
      expect(result.success).toBe(true);
      expect(result.behavior).toBe("success");
      expect(result.providerResponse.status).toBe("succeeded");
    });

    it("decline card returns insufficient funds", () => {
      const result = sandbox.simulatePayment("4000000000000002", 5000);
      expect(result.success).toBe(false);
      expect(result.behavior).toBe("decline_insufficient_funds");
      expect(result.providerResponse.declineCode).toBe("insufficient_funds");
      expect(result.retryable).toBe(false);
    });

    it("3ds card returns requires_action", () => {
      const result = sandbox.simulatePayment("4000000000003220", 5000);
      expect(result.success).toBe(false);
      expect(result.providerResponse.threeDSecureRequired).toBe(true);
    });

    it("timeout card returns failed with error", () => {
      const result = sandbox.simulatePayment("4000000000000069", 5000);
      expect(result.success).toBe(false);
      expect(result.behavior).toBe("timeout");
      expect(result.providerResponse.error).toContain("timeout");
      expect(result.retryable).toBe(true);
    });

    it("fraud card returns blocked with high score", () => {
      const result = sandbox.simulatePayment("4000000000000127", 5000);
      expect(result.success).toBe(false);
      expect(result.providerResponse.fraudScore).toBe(95);
    });

    it("success_then_dispute card returns succeeded", () => {
      const result = sandbox.simulatePayment("4000000000004954", 5000);
      expect(result.success).toBe(true);
      expect(result.behavior).toBe("success_then_dispute");
    });

    it("soft decline card behavior depends on amount parity", () => {
      const odd = sandbox.simulatePayment("4000000000009995", 1001);
      expect(odd.success).toBe(false);
      expect(odd.retryable).toBe(true);

      const even = sandbox.simulatePayment("4000000000009995", 1000);
      expect(even.success).toBe(true);
    });

    it("unknown card defaults to success", () => {
      const result = sandbox.simulatePayment("5555555555554444", 5000);
      expect(result.success).toBe(true);
      expect(result.behavior).toBe("success");
    });
  });

  describe("getTestCards", () => {
    it("returns all 7 test cards", () => {
      const prisma = createMockPrisma();
      const sandbox = createSandboxService(prisma, TENANT_ID);
      const cards = sandbox.getTestCards();
      expect(cards.length).toBe(7);
      expect(cards.every((c) => c.number && c.behavior && c.description)).toBe(true);
    });
  });

  describe("triggerDispute", () => {
    it("creates a dispute for an existing payment", async () => {
      const prisma = createMockPrisma();
      prisma._addEvent(TENANT_ID, "pay_123");
      const sandbox = createSandboxService(prisma, TENANT_ID);

      const result = await sandbox.triggerDispute("pay_123");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.paymentId).toBe("pay_123");
        expect(result.value.disputeId).toMatch(/^dsp_/);
      }
    });

    it("returns NOT_FOUND for non-existent payment", async () => {
      const prisma = createMockPrisma();
      const sandbox = createSandboxService(prisma, TENANT_ID);

      const result = await sandbox.triggerDispute("pay_nonexistent");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("NOT_FOUND");
      }
    });
  });

  describe("resetSandboxData", () => {
    it("deletes saga executions, events, and snapshots", async () => {
      const prisma = createMockPrisma();
      const sandbox = createSandboxService(prisma, TENANT_ID);

      const result = await sandbox.resetSandboxData();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.deleted).toBe(10); // 3 + 5 + 2
      }
    });
  });
});

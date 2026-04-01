import { describe, it, expect, vi, beforeEach } from "vitest";
import { createThreeDSecureService } from "./three-d-secure-service.js";

function createMockPrisma() {
  const records: Array<Record<string, unknown>> = [];

  return {
    _records: records,
    threeDSecure: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const record = { ...data, createdAt: new Date() };
        records.push(record);
        return record;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where["id"]) {
          return records.find((r) => r["id"] === where["id"] && r["tenantId"] === where["tenantId"]) ?? null;
        }
        return records.find((r) => r["paymentId"] === where["paymentId"] && r["tenantId"] === where["tenantId"]) ?? null;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const record = records.find((r) => r["id"] === where.id);
        if (!record) throw new Error("Not found");
        Object.assign(record, data);
        return record;
      }),
    },
  };
}

describe("ThreeDSecureService", () => {
  const TENANT_ID = "tenant-3ds-1";
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: ReturnType<typeof createThreeDSecureService>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = createThreeDSecureService(prisma as never, TENANT_ID);
  });

  describe("shouldRequire", () => {
    it("requires 3DS for EU region (PSD2)", () => {
      expect(service.shouldRequire({ amount: 5000, currency: "EUR", region: "EU" })).toBe(true);
    });

    it("requires 3DS for high fraud score", () => {
      expect(service.shouldRequire({ amount: 5000, currency: "USD", fraudScore: 75 })).toBe(true);
    });

    it("does not require 3DS for low-value transactions", () => {
      expect(service.shouldRequire({ amount: 2000, currency: "EUR" })).toBe(false);
    });

    it("does not require 3DS for trusted beneficiaries", () => {
      expect(service.shouldRequire({ amount: 50000, currency: "EUR", region: "EU", isTrustedBeneficiary: true })).toBe(false);
    });

    it("returns deterministic result for same input", () => {
      const params = { amount: 15000, currency: "USD" };
      const result1 = service.shouldRequire(params);
      const result2 = service.shouldRequire(params);
      expect(result1).toBe(result2);
    });

    it("requires for specific EU countries", () => {
      expect(service.shouldRequire({ amount: 5000, currency: "EUR", region: "DE" })).toBe(true);
      expect(service.shouldRequire({ amount: 5000, currency: "EUR", region: "FR" })).toBe(true);
    });
  });

  describe("initiate", () => {
    it("creates a challenge_required record for EU payment", async () => {
      const result = await service.initiate("pay-1", {
        amount: 5000,
        currency: "EUR",
        region: "EU",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("challenge_required");
      expect(result.value.eci).toBe("05");
      expect(result.value.challengeUrl).toContain("/3ds/challenge/");
      expect(result.value.liabilityShift).toBe(false);
      expect(result.value.paymentId).toBe("pay-1");
    });

    it("creates a frictionless record for low-risk 3DS2", async () => {
      const result = await service.initiate("pay-2", {
        amount: 2000,
        currency: "USD",
        region: "US",
        fraudScore: 10,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Low amount + low fraud + US = frictionless
      expect(result.value.status).toBe("frictionless");
      expect(result.value.liabilityShift).toBe(true);
      expect(result.value.cavv).not.toBe("");
      expect(result.value.completedAt).not.toBeNull();
    });

    it("uses 3DS1 with eci=06 when specified", async () => {
      const result = await service.initiate("pay-3", {
        amount: 5000,
        currency: "EUR",
        region: "EU",
        version: "3ds1",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.version).toBe("3ds1");
      expect(result.value.eci).toBe("06");
    });

    it("generates dsTransId for every initiation", async () => {
      const result = await service.initiate("pay-4", { amount: 5000, currency: "USD" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.dsTransId).toMatch(/^ds-/);
    });
  });

  describe("complete", () => {
    it("marks as authenticated with liability shift", async () => {
      const initResult = await service.initiate("pay-5", {
        amount: 5000,
        currency: "EUR",
        region: "EU",
      });
      expect(initResult.ok).toBe(true);
      if (!initResult.ok) return;

      const result = await service.complete(initResult.value.id, "authenticated");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("authenticated");
      expect(result.value.liabilityShift).toBe(true);
      expect(result.value.cavv).not.toBe("");
      expect(result.value.completedAt).not.toBeNull();
    });

    it("marks as failed without liability shift", async () => {
      const initResult = await service.initiate("pay-6", {
        amount: 5000,
        currency: "EUR",
        region: "EU",
      });
      expect(initResult.ok).toBe(true);
      if (!initResult.ok) return;

      const result = await service.complete(initResult.value.id, "failed");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("failed");
      expect(result.value.liabilityShift).toBe(false);
      expect(result.value.cavv).toBe("");
    });

    it("rejects completing already-authenticated record", async () => {
      const initResult = await service.initiate("pay-7", {
        amount: 5000,
        currency: "EUR",
        region: "EU",
      });
      expect(initResult.ok).toBe(true);
      if (!initResult.ok) return;

      await service.complete(initResult.value.id, "authenticated");
      const result = await service.complete(initResult.value.id, "authenticated");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("ALREADY_COMPLETED");
    });

    it("returns NOT_FOUND for non-existent record", async () => {
      const result = await service.complete("nonexistent", "authenticated");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  describe("check", () => {
    it("returns null for payment without 3DS", async () => {
      const result = await service.check("pay-no-3ds");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it("returns existing 3DS record for payment", async () => {
      await service.initiate("pay-8", { amount: 5000, currency: "EUR", region: "EU" });
      const result = await service.check("pay-8");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).not.toBeNull();
      expect(result.value!.paymentId).toBe("pay-8");
    });
  });
});

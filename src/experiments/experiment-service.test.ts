import { describe, it, expect, vi, beforeEach } from "vitest";
import { createExperimentService, chiSquaredTest } from "./experiment-service.js";

function createMockPrisma() {
  const experiments: Array<Record<string, unknown>> = [];
  const eventStoreRecords: Array<Record<string, unknown>> = [];
  const providerMetrics: Array<Record<string, unknown>> = [];

  return {
    _experiments: experiments,
    _eventStoreRecords: eventStoreRecords,
    _providerMetrics: providerMetrics,
    routingExperiment: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const record = {
          ...data,
          winnerVariant: null,
          startedAt: null,
          endedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        experiments.push(record);
        return record;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return experiments.find((e) => {
          if (where["id"]) {
            if (typeof where["id"] === "string") {
              if (e["id"] !== where["id"]) return false;
            } else if (typeof where["id"] === "object") {
              const clause = where["id"] as { not?: string };
              if (clause.not && e["id"] === clause.not) return false;
            }
          }
          if (where["tenantId"] && e["tenantId"] !== where["tenantId"]) return false;
          if (where["status"] && e["status"] !== where["status"]) return false;
          return true;
        }) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where: { tenantId: string } }) => {
        return experiments.filter((e) => e["tenantId"] === where.tenantId);
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const exp = experiments.find((e) => e["id"] === where.id);
        if (!exp) throw new Error("Not found");
        Object.assign(exp, data, { updatedAt: new Date() });
        return exp;
      }),
    },
    eventStore: {
      findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return eventStoreRecords.filter((e) => {
          if (where["tenantId"] && e["tenantId"] !== where["tenantId"]) return false;
          if (where["eventType"] && e["eventType"] !== where["eventType"]) return false;
          return true;
        });
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return eventStoreRecords.find((e) => {
          if (where["tenantId"] && e["tenantId"] !== where["tenantId"]) return false;
          if (where["aggregateId"] && e["aggregateId"] !== where["aggregateId"]) return false;
          const eventType = where["eventType"] as { in?: string[] } | undefined;
          if (eventType?.in && !eventType.in.includes(e["eventType"] as string)) return false;
          return true;
        }) ?? null;
      }),
    },
    providerMetric: {
      findMany: vi.fn().mockImplementation(async () => providerMetrics),
    },
  };
}

function createMockEventStore() {
  const events: Array<Record<string, unknown>> = [];
  return {
    _events: events,
    append: vi.fn().mockImplementation(async () => ({ ok: true, value: {} })),
    getByAggregateId: vi.fn().mockImplementation(async () => ({ ok: true, value: events })),
  };
}

const TENANT_ID = "tenant-exp-1";

describe("ExperimentService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let eventStore: ReturnType<typeof createMockEventStore>;
  let service: ReturnType<typeof createExperimentService>;

  beforeEach(() => {
    prisma = createMockPrisma();
    eventStore = createMockEventStore();
    service = createExperimentService(prisma as never, TENANT_ID, eventStore as never);
  });

  describe("createExperiment", () => {
    it("creates an experiment in draft status", async () => {
      const result = await service.createExperiment({
        name: "Stripe vs Adyen",
        controlProviderId: "stripe",
        controlWeight: 50,
        variants: [{ name: "adyen_variant", providerId: "adyen", weight: 50 }],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.name).toBe("Stripe vs Adyen");
      expect(result.value.status).toBe("draft");
      expect(result.value.controlProviderId).toBe("stripe");
      expect(result.value.variants).toHaveLength(1);
    });

    it("rejects missing name", async () => {
      const result = await service.createExperiment({
        name: "",
        controlProviderId: "stripe",
        variants: [{ name: "test", providerId: "adyen", weight: 50 }],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
    });

    it("rejects no variants", async () => {
      const result = await service.createExperiment({
        name: "Test",
        controlProviderId: "stripe",
        variants: [],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
    });

    it("rejects weights not summing to 100", async () => {
      const result = await service.createExperiment({
        name: "Test",
        controlProviderId: "stripe",
        controlWeight: 60,
        variants: [{ name: "test", providerId: "adyen", weight: 50 }],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toContain("110");
    });

    it("accepts multiple variants", async () => {
      const result = await service.createExperiment({
        name: "Three-way test",
        controlProviderId: "stripe",
        controlWeight: 34,
        variants: [
          { name: "adyen_variant", providerId: "adyen", weight: 33 },
          { name: "paypal_variant", providerId: "paypal", weight: 33 },
        ],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.variants).toHaveLength(2);
    });
  });

  describe("startExperiment", () => {
    it("starts a draft experiment", async () => {
      const create = await service.createExperiment({
        name: "Test",
        controlProviderId: "stripe",
        controlWeight: 50,
        variants: [{ name: "variant_a", providerId: "adyen", weight: 50 }],
      });
      expect(create.ok).toBe(true);
      if (!create.ok) return;

      const result = await service.startExperiment(create.value.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("running");
      expect(result.value.startedAt).toBeTruthy();
    });

    it("rejects starting a completed experiment", async () => {
      prisma._experiments.push({
        id: "exp-completed",
        tenantId: TENANT_ID,
        name: "Done",
        description: "",
        status: "completed",
        controlProviderId: "stripe",
        controlWeight: 50,
        variants: [{ name: "v", providerId: "adyen", weight: 50 }],
        trafficAllocation: 100,
        targetMetrics: ["authorization_rate"],
        minimumSampleSize: 1000,
        confidenceLevel: 95,
        winnerVariant: null,
        startedAt: null,
        endedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.startExperiment("exp-completed");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_STATUS");
    });

    it("rejects if another experiment is running", async () => {
      prisma._experiments.push({
        id: "exp-running",
        tenantId: TENANT_ID,
        name: "Running",
        description: "",
        status: "running",
        controlProviderId: "stripe",
        controlWeight: 50,
        variants: [{ name: "v", providerId: "adyen", weight: 50 }],
        trafficAllocation: 100,
        targetMetrics: ["authorization_rate"],
        minimumSampleSize: 1000,
        confidenceLevel: 95,
        winnerVariant: null,
        startedAt: new Date(),
        endedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const create = await service.createExperiment({
        name: "New",
        controlProviderId: "stripe",
        controlWeight: 50,
        variants: [{ name: "v", providerId: "adyen", weight: 50 }],
      });
      expect(create.ok).toBe(true);
      if (!create.ok) return;

      const result = await service.startExperiment(create.value.id);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_STATUS");
      expect(result.error.message).toContain("Running");
    });
  });

  describe("pauseExperiment", () => {
    it("pauses a running experiment", async () => {
      const create = await service.createExperiment({
        name: "Test",
        controlProviderId: "stripe",
        controlWeight: 50,
        variants: [{ name: "v", providerId: "adyen", weight: 50 }],
      });
      if (!create.ok) return;
      await service.startExperiment(create.value.id);

      const result = await service.pauseExperiment(create.value.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("paused");
    });
  });

  describe("completeExperiment", () => {
    it("completes a running experiment", async () => {
      const create = await service.createExperiment({
        name: "Test",
        controlProviderId: "stripe",
        controlWeight: 50,
        variants: [{ name: "v", providerId: "adyen", weight: 50 }],
      });
      if (!create.ok) return;
      await service.startExperiment(create.value.id);

      const result = await service.completeExperiment(create.value.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("completed");
      expect(result.value.endedAt).toBeTruthy();
    });
  });

  describe("assignVariant", () => {
    it("assigns variant deterministically based on paymentId", async () => {
      const create = await service.createExperiment({
        name: "Test",
        controlProviderId: "stripe",
        controlWeight: 50,
        variants: [{ name: "variant_a", providerId: "adyen", weight: 50 }],
      });
      if (!create.ok) return;
      await service.startExperiment(create.value.id);

      // Same paymentId should always get same variant
      const result1 = service.assignVariant(create.value.id, "pay-deterministic-1");
      const result2 = service.assignVariant(create.value.id, "pay-deterministic-1");
      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (!result1.ok || !result2.ok) return;
      expect(result1.value.variantName).toBe(result2.value.variantName);
      expect(result1.value.providerId).toBe(result2.value.providerId);
    });

    it("distributes across variants", async () => {
      const create = await service.createExperiment({
        name: "Test",
        controlProviderId: "stripe",
        controlWeight: 50,
        variants: [{ name: "variant_a", providerId: "adyen", weight: 50 }],
      });
      if (!create.ok) return;
      await service.startExperiment(create.value.id);

      const assignments = new Map<string, number>();
      for (let i = 0; i < 100; i++) {
        const result = service.assignVariant(create.value.id, `pay-${i}`);
        if (!result.ok) continue;
        const count = assignments.get(result.value.variantName) ?? 0;
        assignments.set(result.value.variantName, count + 1);
      }

      // Both variants should have some assignments (not all going to one)
      expect(assignments.size).toBeGreaterThanOrEqual(2);
      const controlCount = assignments.get("control") ?? 0;
      const variantCount = assignments.get("variant_a") ?? 0;
      expect(controlCount).toBeGreaterThan(0);
      expect(variantCount).toBeGreaterThan(0);
    });

    it("rejects assignment for non-active experiment", async () => {
      const result = service.assignVariant("nonexistent", "pay-1");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_STATUS");
    });
  });

  describe("listExperiments", () => {
    it("lists all experiments for tenant", async () => {
      await service.createExperiment({
        name: "Exp 1",
        controlProviderId: "stripe",
        controlWeight: 50,
        variants: [{ name: "v", providerId: "adyen", weight: 50 }],
      });
      await service.createExperiment({
        name: "Exp 2",
        controlProviderId: "stripe",
        controlWeight: 50,
        variants: [{ name: "v", providerId: "paypal", weight: 50 }],
      });

      const result = await service.listExperiments();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(2);
    });
  });

  describe("getExperiment", () => {
    it("returns NOT_FOUND for missing experiment", async () => {
      const result = await service.getExperiment("nonexistent");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  describe("declareWinner", () => {
    it("declares a winner and completes the experiment", async () => {
      const create = await service.createExperiment({
        name: "Test",
        controlProviderId: "stripe",
        controlWeight: 50,
        variants: [{ name: "variant_a", providerId: "adyen", weight: 50 }],
      });
      if (!create.ok) return;

      const result = await service.declareWinner(create.value.id, "variant_a");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("completed");
      expect(result.value.winnerVariant).toBe("variant_a");
    });

    it("rejects invalid variant name", async () => {
      const create = await service.createExperiment({
        name: "Test",
        controlProviderId: "stripe",
        controlWeight: 50,
        variants: [{ name: "variant_a", providerId: "adyen", weight: 50 }],
      });
      if (!create.ok) return;

      const result = await service.declareWinner(create.value.id, "nonexistent");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
    });
  });

  describe("getActiveExperiment", () => {
    it("returns null when no experiment is running", async () => {
      const result = await service.getActiveExperiment();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it("returns the running experiment", async () => {
      prisma._experiments.push({
        id: "exp-active",
        tenantId: TENANT_ID,
        name: "Active",
        description: "",
        status: "running",
        controlProviderId: "stripe",
        controlWeight: 50,
        variants: [{ name: "v", providerId: "adyen", weight: 50 }],
        trafficAllocation: 100,
        targetMetrics: ["authorization_rate"],
        minimumSampleSize: 1000,
        confidenceLevel: 95,
        winnerVariant: null,
        startedAt: new Date(),
        endedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getActiveExperiment();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).not.toBeNull();
      expect(result.value!.name).toBe("Active");
    });
  });
});

describe("chiSquaredTest", () => {
  it("returns 0 for empty data", () => {
    expect(chiSquaredTest(0, 0, 0, 0)).toBe(0);
  });

  it("returns 0 when all succeed", () => {
    expect(chiSquaredTest(50, 50, 50, 50)).toBe(0);
  });

  it("detects significant difference", () => {
    // Control: 80/100 success, Variant: 95/100 success
    const chi = chiSquaredTest(80, 100, 95, 100);
    expect(chi).toBeGreaterThan(3.841); // Significant at 95%
  });

  it("detects non-significant difference", () => {
    // Control: 48/100, Variant: 52/100 — small difference
    const chi = chiSquaredTest(48, 100, 52, 100);
    expect(chi).toBeLessThan(3.841); // Not significant at 95%
  });

  it("handles unequal sample sizes", () => {
    const chi = chiSquaredTest(90, 100, 80, 200);
    expect(chi).toBeGreaterThan(0);
  });
});

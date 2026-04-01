import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProviderMetrics, type ProviderMetricRecord } from "./provider-metrics.js";

function makeRecord(overrides: Partial<ProviderMetricRecord> = {}): ProviderMetricRecord {
  return {
    provider: "stripe",
    outcome: "success",
    latencyMs: 100,
    amount: 1000,
    currency: "USD",
    ...overrides,
  };
}

function makeStoredRecord(outcome: string, latencyMs: number) {
  return { outcome, latencyMs };
}

function createMockPrisma() {
  const records: { id: string; provider: string; outcome: string; latencyMs: number; declineCode: string | null; amount: number; currency: string; createdAt: Date }[] = [];

  return {
    _records: records,
    providerMetric: {
      create: vi.fn().mockImplementation(async ({ data }: { data: { id: string; provider: string; outcome: string; latencyMs: number; declineCode: string | null; amount: number; currency: string } }) => {
        const record = { ...data, createdAt: new Date() };
        records.push(record);
        return record;
      }),
      count: vi.fn().mockImplementation(async ({ where }: { where: { provider?: string; outcome?: string; createdAt?: { gte: Date } } }) => {
        return records.filter((r) => {
          if (where.provider && r.provider !== where.provider) return false;
          if (where.outcome && r.outcome !== where.outcome) return false;
          return true;
        }).length;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where: { provider?: string; createdAt?: { gte: Date } } }) => {
        return records
          .filter((r) => {
            if (where.provider && r.provider !== where.provider) return false;
            return true;
          })
          .sort((a, b) => a.latencyMs - b.latencyMs);
      }),
    },
  } as unknown as import("@prisma/client").PrismaClient & { _records: typeof records };
}

describe("ProviderMetrics — record", () => {
  it("persists a metric record successfully", async () => {
    const prisma = createMockPrisma();
    const metrics = createProviderMetrics(prisma);

    const result = await metrics.record(makeRecord());

    expect(result.ok).toBe(true);
    expect(prisma.providerMetric.create).toHaveBeenCalledOnce();
  });

  it("stores declineCode as null when not provided", async () => {
    const prisma = createMockPrisma();
    const metrics = createProviderMetrics(prisma);

    await metrics.record(makeRecord({ outcome: "failure" }));

    const call = (prisma.providerMetric.create as ReturnType<typeof vi.fn>).mock.calls[0] as [{ data: { declineCode: string | null } }];
    expect(call[0].data.declineCode).toBeNull();
  });

  it("stores declineCode when provided", async () => {
    const prisma = createMockPrisma();
    const metrics = createProviderMetrics(prisma);

    await metrics.record(makeRecord({ outcome: "failure", declineCode: "insufficient_funds" }));

    const call = (prisma.providerMetric.create as ReturnType<typeof vi.fn>).mock.calls[0] as [{ data: { declineCode: string | null } }];
    expect(call[0].data.declineCode).toBe("insufficient_funds");
  });

  it("returns an error result when the database throws", async () => {
    const prisma = createMockPrisma();
    (prisma.providerMetric.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DB down"));
    const metrics = createProviderMetrics(prisma);

    const result = await metrics.record(makeRecord());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("DB down");
  });
});

describe("ProviderMetrics — getSuccessRate", () => {
  it("returns 1.0 when there are no records in the window", async () => {
    const prisma = createMockPrisma();
    const metrics = createProviderMetrics(prisma);

    // count always returns 0 for empty store
    const result = await metrics.getSuccessRate("stripe", 3_600_000);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(1.0);
  });

  it("computes correct success rate from recorded data", async () => {
    const prisma = createMockPrisma();
    // Manually stub count: 4 total, 3 successes
    (prisma.providerMetric.count as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(4)   // total
      .mockResolvedValueOnce(3);  // successes

    const metrics = createProviderMetrics(prisma);
    const result = await metrics.getSuccessRate("stripe", 3_600_000);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeCloseTo(0.75);
  });

  it("returns an error result when the database throws", async () => {
    const prisma = createMockPrisma();
    (prisma.providerMetric.count as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("timeout"));

    const metrics = createProviderMetrics(prisma);
    const result = await metrics.getSuccessRate("stripe", 3_600_000);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("timeout");
  });
});

describe("ProviderMetrics — getStats", () => {
  it("returns zero-value defaults when no records exist for the provider", async () => {
    const prisma = createMockPrisma();
    const metrics = createProviderMetrics(prisma);

    const result = await metrics.getStats("stripe", 3_600_000);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalRequests).toBe(0);
    expect(result.value.successRate).toBe(1.0);
    expect(result.value.avgLatencyMs).toBe(0);
    expect(result.value.p50LatencyMs).toBe(0);
    expect(result.value.p95LatencyMs).toBe(0);
    expect(result.value.p99LatencyMs).toBe(0);
  });

  it("computes correct totals and counts", async () => {
    const prisma = createMockPrisma();
    (prisma.providerMetric.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeStoredRecord("success", 100),
      makeStoredRecord("success", 200),
      makeStoredRecord("failure", 300),
    ]);

    const metrics = createProviderMetrics(prisma);
    const result = await metrics.getStats("stripe", 3_600_000);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalRequests).toBe(3);
    expect(result.value.successCount).toBe(2);
    expect(result.value.failureCount).toBe(1);
    expect(result.value.successRate).toBeCloseTo(2 / 3);
  });

  it("computes average latency correctly", async () => {
    const prisma = createMockPrisma();
    (prisma.providerMetric.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeStoredRecord("success", 100),
      makeStoredRecord("success", 300),
    ]);

    const metrics = createProviderMetrics(prisma);
    const result = await metrics.getStats("stripe", 3_600_000);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.avgLatencyMs).toBe(200);
  });

  it("computes p50 percentile correctly", async () => {
    // 10 sorted values: 10, 20, 30, 40, 50, 60, 70, 80, 90, 100
    // p50 = ceil(0.5 * 10) - 1 = index 4 = 50
    const prisma = createMockPrisma();
    (prisma.providerMetric.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((ms) => makeStoredRecord("success", ms)),
    );

    const metrics = createProviderMetrics(prisma);
    const result = await metrics.getStats("stripe", 3_600_000);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.p50LatencyMs).toBe(50);
  });

  it("computes p95 percentile correctly", async () => {
    // 20 values 5 to 100; p95 = ceil(0.95 * 20) - 1 = index 18 = 95
    const prisma = createMockPrisma();
    (prisma.providerMetric.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => makeStoredRecord("success", (i + 1) * 5)),
    );

    const metrics = createProviderMetrics(prisma);
    const result = await metrics.getStats("stripe", 3_600_000);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.p95LatencyMs).toBe(95);
  });

  it("returns an error result when the database throws", async () => {
    const prisma = createMockPrisma();
    (prisma.providerMetric.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("query failed"));

    const metrics = createProviderMetrics(prisma);
    const result = await metrics.getStats("stripe", 3_600_000);

    expect(result.ok).toBe(false);
  });
});

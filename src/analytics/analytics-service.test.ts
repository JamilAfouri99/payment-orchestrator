import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAnalyticsService, buildTimeWindow } from "./analytics-service.js";

function createMockPrisma() {
  const metricSnapshots: Array<Record<string, unknown>> = [];
  const providerMetrics: Array<{
    id: string;
    tenantId: string;
    provider: string;
    outcome: string;
    latencyMs: number;
    declineCode: string | null;
    amount: number;
    currency: string;
    createdAt: Date;
  }> = [];
  const eventStoreRecords: Array<{
    id: string;
    tenantId: string;
    aggregateId: string;
    aggregateType: string;
    eventType: string;
    version: number;
    payload: Record<string, unknown>;
    metadata: Record<string, unknown>;
    createdAt: Date;
  }> = [];
  const ledgerEntries: Array<{
    id: string;
    tenantId: string;
    accountId: string;
    direction: string;
    amount: number;
    effectiveAt: Date;
  }> = [];
  const ledgerAccounts: Array<{
    id: string;
    tenantId: string;
    name: string;
  }> = [];

  return {
    _metricSnapshots: metricSnapshots,
    _providerMetrics: providerMetrics,
    _eventStoreRecords: eventStoreRecords,
    _ledgerEntries: ledgerEntries,
    _ledgerAccounts: ledgerAccounts,
    paymentMetricSnapshot: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const record = { ...data, computedAt: data.computedAt ?? now };
        metricSnapshots.push(record);
        return record;
      }),
      findMany: vi.fn().mockImplementation(async ({ where, orderBy: _orderBy, take: _take }: {
        where: Record<string, unknown>;
        orderBy?: unknown;
        take?: number;
      }) => {
        return metricSnapshots.filter((s) => {
          if (where["tenantId"] && s["tenantId"] !== where["tenantId"]) return false;
          if (where["metricName"] && s["metricName"] !== where["metricName"]) return false;
          if (where["providerId"] !== undefined && s["providerId"] !== where["providerId"]) return false;
          if (where["merchantAccountId"] !== undefined && s["merchantAccountId"] !== where["merchantAccountId"]) return false;
          return true;
        });
      }),
    },
    providerMetric: {
      findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return providerMetrics.filter((m) => {
          if (where["tenantId"] && m.tenantId !== where["tenantId"]) return false;
          return true;
        });
      }),
    },
    eventStore: {
      findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return eventStoreRecords.filter((e) => {
          if (where["tenantId"] && e.tenantId !== where["tenantId"]) return false;
          const eventTypes = where["eventType"] as { in?: string[] } | undefined;
          if (eventTypes?.in && !eventTypes.in.includes(e.eventType)) return false;
          return true;
        });
      }),
    },
    ledgerEntry: {
      findMany: vi.fn().mockImplementation(async () => ledgerEntries),
    },
    ledgerAccount: {
      findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return ledgerAccounts.filter((a) => {
          if (where["tenantId"] && a.tenantId !== where["tenantId"]) return false;
          if (where["name"] && a.name !== where["name"]) return false;
          return true;
        });
      }),
    },
  };
}

describe("AnalyticsService", () => {
  const TENANT_ID = "tenant-analytics-1";
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: ReturnType<typeof createAnalyticsService>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = createAnalyticsService(prisma as never, TENANT_ID);
  });

  describe("buildTimeWindow", () => {
    it("builds 1h window", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      const window = buildTimeWindow("1h", now);
      expect(window.name).toBe("1h");
      expect(window.end).toEqual(now);
      expect(window.start).toEqual(new Date("2024-01-15T11:00:00Z"));
    });

    it("builds 24h window", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      const window = buildTimeWindow("24h", now);
      expect(window.start).toEqual(new Date("2024-01-14T12:00:00Z"));
    });

    it("builds 7d window", () => {
      const now = new Date("2024-01-15T12:00:00Z");
      const window = buildTimeWindow("7d", now);
      expect(window.start).toEqual(new Date("2024-01-08T12:00:00Z"));
    });
  });

  describe("computeMetrics", () => {
    it("computes metrics from events and provider data", async () => {
      // Seed payment events
      prisma._eventStoreRecords.push(
        { id: "e1", tenantId: TENANT_ID, aggregateId: "pay-1", aggregateType: "Payment", eventType: "PaymentInitiated", version: 1, payload: { amount: 5000 }, metadata: {}, createdAt: new Date() },
        { id: "e2", tenantId: TENANT_ID, aggregateId: "pay-1", aggregateType: "Payment", eventType: "PaymentCompleted", version: 2, payload: { amount: 5000 }, metadata: {}, createdAt: new Date() },
        { id: "e3", tenantId: TENANT_ID, aggregateId: "pay-2", aggregateType: "Payment", eventType: "PaymentInitiated", version: 1, payload: { amount: 3000 }, metadata: {}, createdAt: new Date() },
        { id: "e4", tenantId: TENANT_ID, aggregateId: "pay-2", aggregateType: "Payment", eventType: "PaymentFailed", version: 2, payload: { amount: 3000 }, metadata: {}, createdAt: new Date() },
      );

      // Seed provider metrics
      prisma._providerMetrics.push(
        { id: "pm1", tenantId: TENANT_ID, provider: "stripe", outcome: "success", latencyMs: 100, declineCode: null, amount: 5000, currency: "USD", createdAt: new Date() },
        { id: "pm2", tenantId: TENANT_ID, provider: "stripe", outcome: "failure", latencyMs: 200, declineCode: "card_declined", amount: 3000, currency: "USD", createdAt: new Date() },
      );

      // Seed fee account
      prisma._ledgerAccounts.push({ id: "acc-fees", tenantId: TENANT_ID, name: "platform_fees" });
      prisma._ledgerEntries.push({ id: "le1", tenantId: TENANT_ID, accountId: "acc-fees", direction: "credit", amount: 150, effectiveAt: new Date() });

      const window = buildTimeWindow("24h");
      const result = await service.computeMetrics(window);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Should have overall metrics + per-provider metrics
      expect(result.value.length).toBeGreaterThan(8);

      // Check authorization rate
      const authRate = result.value.find((m) => m.metricName === "authorization_rate" && !m.providerId);
      expect(authRate).toBeDefined();
      expect(authRate!.value).toBe(0.5); // 1 completed / 2 initiated

      // Check GPV
      const gpv = result.value.find((m) => m.metricName === "gross_payment_volume");
      expect(gpv).toBeDefined();
      expect(gpv!.value).toBe(8000); // 5000 + 3000

      // Check per-provider auth rate
      const stripeAuth = result.value.find((m) => m.metricName === "authorization_rate" && m.providerId === "stripe");
      expect(stripeAuth).toBeDefined();
      expect(stripeAuth!.value).toBe(0.5);

      // Check avg latency per provider
      const stripeLatency = result.value.find((m) => m.metricName === "avg_latency" && m.providerId === "stripe");
      expect(stripeLatency).toBeDefined();
      expect(stripeLatency!.value).toBe(150); // (100 + 200) / 2
    });

    it("handles empty data", async () => {
      const window = buildTimeWindow("1h");
      const result = await service.computeMetrics(window);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const authRate = result.value.find((m) => m.metricName === "authorization_rate" && !m.providerId);
      expect(authRate!.value).toBe(0);
    });
  });

  describe("getMetrics", () => {
    it("returns filtered metrics", async () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 3600000);
      prisma._metricSnapshots.push(
        { id: "s1", tenantId: TENANT_ID, metricName: "authorization_rate", value: 0.95, providerId: null, merchantAccountId: null, periodStart: earlier, periodEnd: now, computedAt: now },
        { id: "s2", tenantId: TENANT_ID, metricName: "avg_latency", value: 120, providerId: "stripe", merchantAccountId: null, periodStart: earlier, periodEnd: now, computedAt: now },
      );

      const result = await service.getMetrics({ metricName: "authorization_rate" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(1);
      expect(result.value[0]!.metricName).toBe("authorization_rate");
    });

    it("returns all metrics without filters", async () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 3600000);
      prisma._metricSnapshots.push(
        { id: "s1", tenantId: TENANT_ID, metricName: "authorization_rate", value: 0.95, providerId: null, merchantAccountId: null, periodStart: earlier, periodEnd: now, computedAt: now },
        { id: "s2", tenantId: TENANT_ID, metricName: "avg_latency", value: 120, providerId: "stripe", merchantAccountId: null, periodStart: earlier, periodEnd: now, computedAt: now },
      );

      const result = await service.getMetrics({});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(2);
    });
  });

  describe("getTimeSeries", () => {
    it("returns time series points", async () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 3600000);
      prisma._metricSnapshots.push(
        { id: "s1", tenantId: TENANT_ID, metricName: "authorization_rate", value: 0.9, providerId: null, merchantAccountId: null, periodStart: new Date(now.getTime() - 7200000), periodEnd: earlier, computedAt: earlier },
        { id: "s2", tenantId: TENANT_ID, metricName: "authorization_rate", value: 0.95, providerId: null, merchantAccountId: null, periodStart: earlier, periodEnd: now, computedAt: now },
      );

      const result = await service.getTimeSeries(
        "authorization_rate",
        new Date(now.getTime() - 86400000),
        now,
        "1h",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(2);
    });
  });

  describe("compareWindows", () => {
    it("computes change between windows", async () => {
      // Override findMany to filter by periodEnd range
      prisma.paymentMetricSnapshot.findMany = vi.fn()
        .mockImplementationOnce(async () => [
          { id: "s1", tenantId: TENANT_ID, metricName: "authorization_rate", value: 0.95, providerId: null, merchantAccountId: null, periodEnd: new Date("2024-01-15T12:00:00Z"), computedAt: new Date("2024-01-15T12:00:00Z") },
        ])
        .mockImplementationOnce(async () => [
          { id: "s2", tenantId: TENANT_ID, metricName: "authorization_rate", value: 0.90, providerId: null, merchantAccountId: null, periodEnd: new Date("2024-01-14T12:00:00Z"), computedAt: new Date("2024-01-14T12:00:00Z") },
        ]);

      const now = new Date("2024-01-15T12:00:00Z");
      const current = buildTimeWindow("24h", now);
      const previous = buildTimeWindow("24h", current.start);

      const result = await service.compareWindows("authorization_rate", current, previous);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.metricName).toBe("authorization_rate");
      expect(result.value.current.value).toBe(0.95);
      expect(result.value.previous.value).toBe(0.90);
      expect(result.value.improved).toBe(true);
      expect(result.value.changePercent).toBeGreaterThan(0);
    });
  });
});

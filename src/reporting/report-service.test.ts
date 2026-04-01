import { describe, it, expect, vi, beforeEach } from "vitest";
import { createReportService } from "./report-service.js";

function createMockPrisma() {
  const reportJobs: Array<Record<string, unknown>> = [];
  const eventStoreRecords: Array<Record<string, unknown>> = [];
  const settlements: Array<Record<string, unknown>> = [];
  const disputes: Array<Record<string, unknown>> = [];
  const ledgerEntries: Array<Record<string, unknown>> = [];
  const ledgerAccounts: Array<Record<string, unknown>> = [];

  return {
    _reportJobs: reportJobs,
    _eventStoreRecords: eventStoreRecords,
    _settlements: settlements,
    _disputes: disputes,
    reportJob: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const record = {
          ...data,
          reportData: null,
          rowCount: 0,
          summary: {},
          startedAt: null,
          completedAt: null,
          error: null,
          createdAt: new Date(),
        };
        reportJobs.push(record);
        return record;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const job = reportJobs.find((j) => j["id"] === where.id);
        if (!job) throw new Error("Not found");
        Object.assign(job, data);
        return job;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: { id: string; tenantId: string } }) => {
        return reportJobs.find((j) => j["id"] === where.id && j["tenantId"] === where.tenantId) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where: { tenantId: string } }) => {
        return reportJobs.filter((j) => j["tenantId"] === where.tenantId);
      }),
    },
    eventStore: {
      findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        return eventStoreRecords.filter((e) => {
          if (where["tenantId"] && e["tenantId"] !== where["tenantId"]) return false;
          const eventType = where["eventType"] as { in?: string[] } | string | undefined;
          if (typeof eventType === "string" && e["eventType"] !== eventType) return false;
          if (typeof eventType === "object" && eventType?.in && !eventType.in.includes(e["eventType"] as string)) return false;
          return true;
        });
      }),
      findFirst: vi.fn().mockImplementation(async () => null),
    },
    settlement: {
      findMany: vi.fn().mockImplementation(async () => settlements),
    },
    dispute: {
      findMany: vi.fn().mockImplementation(async () => disputes),
    },
    ledgerEntry: {
      findMany: vi.fn().mockImplementation(async () => ledgerEntries),
    },
    ledgerAccount: {
      findMany: vi.fn().mockImplementation(async () => ledgerAccounts),
    },
  };
}

function createMockEventStore() {
  return {
    append: vi.fn().mockImplementation(async () => ({ ok: true, value: {} })),
    getByAggregateId: vi.fn().mockImplementation(async () => ({ ok: true, value: [] })),
  };
}

describe("ReportService", () => {
  const TENANT_ID = "tenant-report-1";
  let prisma: ReturnType<typeof createMockPrisma>;
  let eventStore: ReturnType<typeof createMockEventStore>;
  let service: ReturnType<typeof createReportService>;

  beforeEach(() => {
    prisma = createMockPrisma();
    eventStore = createMockEventStore();
    service = createReportService(prisma as never, TENANT_ID, eventStore as never);
  });

  describe("generateTransactionReport", () => {
    it("creates a pending report job", async () => {
      const result = await service.generateTransactionReport({
        dateRange: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.type).toBe("transaction");
      expect(result.value.status).toBe("pending");
      expect(result.value.tenantId).toBe(TENANT_ID);
    });

    it("generates CSV data asynchronously", async () => {
      prisma._eventStoreRecords.push({
        id: "e1",
        tenantId: TENANT_ID,
        aggregateId: "pay-1",
        eventType: "PaymentInitiated",
        payload: { amount: 5000, currency: "USD", customerId: "cust-1", orderId: "ord-1" },
        createdAt: new Date("2024-01-15"),
      });

      const result = await service.generateTransactionReport({
        dateRange: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
      });
      expect(result.ok).toBe(true);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that the job was updated to processing then completed
      expect(prisma.reportJob.update).toHaveBeenCalled();
    });
  });

  describe("generateSettlementReport", () => {
    it("creates a settlement report job", async () => {
      const result = await service.generateSettlementReport({
        start: new Date("2024-01-01"),
        end: new Date("2024-01-31"),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.type).toBe("settlement");
    });
  });

  describe("generateDisputeReport", () => {
    it("creates a dispute report job", async () => {
      const result = await service.generateDisputeReport({
        start: new Date("2024-01-01"),
        end: new Date("2024-01-31"),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.type).toBe("dispute");
    });
  });

  describe("generateRevenueReport", () => {
    it("creates a revenue report job", async () => {
      const result = await service.generateRevenueReport({
        start: new Date("2024-01-01"),
        end: new Date("2024-01-31"),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.type).toBe("revenue");
    });
  });

  describe("getReport", () => {
    it("returns a report by id", async () => {
      await service.generateTransactionReport({
        dateRange: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
      });

      const jobId = prisma._reportJobs[0]!["id"] as string;
      const result = await service.getReport(jobId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.id).toBe(jobId);
    });

    it("returns NOT_FOUND for missing report", async () => {
      const result = await service.getReport("nonexistent");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  describe("getReportData", () => {
    it("returns NOT_FOUND for incomplete report", async () => {
      // Pre-populate a pending job without triggering async processing
      prisma._reportJobs.push({
        id: "pending-report",
        tenantId: TENANT_ID,
        type: "transaction",
        status: "processing",
        filters: {},
        dateRangeStart: new Date("2024-01-01"),
        dateRangeEnd: new Date("2024-01-31"),
        format: "csv",
        reportData: null,
        rowCount: 0,
        summary: {},
        startedAt: new Date(),
        completedAt: null,
        error: null,
        createdAt: new Date(),
      });

      const result = await service.getReportData("pending-report");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("returns CSV data for completed report", async () => {
      const job = {
        id: "report-1",
        tenantId: TENANT_ID,
        type: "transaction",
        status: "completed",
        filters: {},
        dateRangeStart: new Date("2024-01-01"),
        dateRangeEnd: new Date("2024-01-31"),
        format: "csv",
        reportData: "header\nrow1",
        rowCount: 1,
        summary: {},
        startedAt: new Date(),
        completedAt: new Date(),
        error: null,
        createdAt: new Date(),
      };
      prisma._reportJobs.push(job);

      const result = await service.getReportData("report-1");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe("header\nrow1");
    });
  });

  describe("listReports", () => {
    it("lists all reports for tenant", async () => {
      await service.generateTransactionReport({
        dateRange: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
      });
      await service.generateSettlementReport({
        start: new Date("2024-01-01"),
        end: new Date("2024-01-31"),
      });

      const result = await service.listReports();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(2);
    });
  });
});

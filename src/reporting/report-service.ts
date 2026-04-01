import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import type { EventStore } from "../events/event-store.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ReportType = "transaction" | "settlement" | "dispute" | "revenue";
export type ReportStatus = "pending" | "processing" | "completed" | "failed";
export type ReportFormat = "csv" | "json";

export interface ReportJob {
  id: string;
  tenantId: string;
  type: ReportType;
  status: ReportStatus;
  filters: Record<string, unknown>;
  dateRangeStart: string;
  dateRangeEnd: string;
  format: ReportFormat;
  rowCount: number;
  summary: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface TransactionReportFilters {
  dateRange: DateRange;
  status?: string | undefined;
  providerId?: string | undefined;
  customerId?: string | undefined;
  format?: ReportFormat | undefined;
}

// ── Error ────────────────────────────────────────────────────────────────────

export class ReportError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "GENERATION_FAILED" | "VALIDATION",
  ) {
    super(message);
    this.name = "ReportError";
  }
}

// ── Service Interface ────────────────────────────────────────────────────────

export interface ReportService {
  generateTransactionReport(filters: TransactionReportFilters): Promise<Result<ReportJob, ReportError>>;
  generateSettlementReport(period: DateRange): Promise<Result<ReportJob, ReportError>>;
  generateDisputeReport(dateRange: DateRange): Promise<Result<ReportJob, ReportError>>;
  generateRevenueReport(dateRange: DateRange): Promise<Result<ReportJob, ReportError>>;
  getReport(reportId: string): Promise<Result<ReportJob, ReportError>>;
  getReportData(reportId: string): Promise<Result<string, ReportError>>;
  listReports(): Promise<Result<ReportJob[], ReportError>>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toReportJob(record: {
  id: string;
  tenantId: string;
  type: string;
  status: string;
  filters: unknown;
  dateRangeStart: Date;
  dateRangeEnd: Date;
  format: string;
  rowCount: number;
  summary: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  createdAt: Date;
}): ReportJob {
  return {
    id: record.id,
    tenantId: record.tenantId,
    type: record.type as ReportType,
    status: record.status as ReportStatus,
    filters: record.filters as Record<string, unknown>,
    dateRangeStart: record.dateRangeStart.toISOString(),
    dateRangeEnd: record.dateRangeEnd.toISOString(),
    format: record.format as ReportFormat,
    rowCount: record.rowCount,
    summary: record.summary as Record<string, unknown>,
    startedAt: record.startedAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    error: record.error,
    createdAt: record.createdAt.toISOString(),
  };
}

function toCsvRow(values: (string | number | null | undefined)[]): string {
  return values.map((v) => {
    if (v === null || v === undefined) return "";
    const str = String(v);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }).join(",");
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createReportService(
  prisma: PrismaClient,
  tenantId: string,
  _eventStore: EventStore,
): ReportService {

  async function createJob(
    type: ReportType,
    dateRange: DateRange,
    filters: Record<string, unknown>,
    format: ReportFormat,
  ): Promise<ReportJob> {
    const record = await prisma.reportJob.create({
      data: {
        id: uuid(),
        tenantId,
        type,
        status: "pending",
        filters: filters as unknown as import("@prisma/client").Prisma.InputJsonValue,
        dateRangeStart: dateRange.start,
        dateRangeEnd: dateRange.end,
        format,
      },
    });
    return toReportJob(record);
  }

  async function processTransactionReport(jobId: string, dateRange: DateRange, filters: Record<string, unknown>): Promise<void> {
    await prisma.reportJob.update({
      where: { id: jobId },
      data: { status: "processing", startedAt: new Date() },
    });

    try {
      const where: Record<string, unknown> = {
        tenantId,
        eventType: "PaymentInitiated",
        createdAt: { gte: dateRange.start, lte: dateRange.end },
      };

      const events = await prisma.eventStore.findMany({
        where,
        orderBy: { createdAt: "desc" },
      });

      const rows: string[] = [];
      rows.push(toCsvRow(["Payment ID", "Amount", "Currency", "Customer ID", "Order ID", "Status", "Created At"]));

      let totalAmount = 0;
      let completedCount = 0;
      let failedCount = 0;

      for (const event of events) {
        const payload = event.payload as Record<string, unknown>;
        const amount = typeof payload["amount"] === "number" ? payload["amount"] : 0;
        const currency = typeof payload["currency"] === "string" ? payload["currency"] : "USD";
        const customerId = typeof payload["customerId"] === "string" ? payload["customerId"] : "";
        const orderId = typeof payload["orderId"] === "string" ? payload["orderId"] : "";

        if (filters["customerId"] && customerId !== filters["customerId"]) continue;

        // Determine final status by checking for completion/failure events
        const statusEvents = await prisma.eventStore.findMany({
          where: {
            tenantId,
            aggregateId: event.aggregateId,
            eventType: { in: ["PaymentCompleted", "PaymentFailed"] },
          },
          take: 1,
        });

        const finalStatus = statusEvents[0]?.eventType === "PaymentCompleted" ? "completed"
          : statusEvents[0]?.eventType === "PaymentFailed" ? "failed"
          : "pending";

        if (filters["status"] && finalStatus !== filters["status"]) continue;

        if (finalStatus === "completed") completedCount++;
        if (finalStatus === "failed") failedCount++;
        totalAmount += amount;

        rows.push(toCsvRow([
          event.aggregateId,
          amount,
          currency,
          customerId,
          orderId,
          finalStatus,
          event.createdAt.toISOString(),
        ]));
      }

      const summary = {
        totalTransactions: rows.length - 1,
        totalAmount,
        completedCount,
        failedCount,
        averageAmount: rows.length > 1 ? Math.round(totalAmount / (rows.length - 1)) : 0,
      };

      // Prepend summary as comment rows
      const summaryRows = [
        `# Transaction Report — ${dateRange.start.toISOString()} to ${dateRange.end.toISOString()}`,
        `# Total Transactions: ${summary.totalTransactions}`,
        `# Total Amount: ${summary.totalAmount}`,
        `# Completed: ${summary.completedCount} | Failed: ${summary.failedCount}`,
        "",
      ];

      const csvData = [...summaryRows, ...rows].join("\n");

      await prisma.reportJob.update({
        where: { id: jobId },
        data: {
          status: "completed",
          completedAt: new Date(),
          reportData: csvData,
          rowCount: rows.length - 1,
          summary,
        },
      });
    } catch (error) {
      await prisma.reportJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  async function processSettlementReport(jobId: string, dateRange: DateRange): Promise<void> {
    await prisma.reportJob.update({
      where: { id: jobId },
      data: { status: "processing", startedAt: new Date() },
    });

    try {
      const settlements = await prisma.settlement.findMany({
        where: {
          tenantId,
          periodStart: { gte: dateRange.start },
          periodEnd: { lte: dateRange.end },
        },
        orderBy: { periodStart: "desc" },
      });

      const rows: string[] = [];
      rows.push(toCsvRow(["Settlement ID", "Merchant Account", "Period Start", "Period End", "Gross Amount", "Fees", "Refunds", "Chargebacks", "Net Amount", "Currency", "Status"]));

      let totalGross = 0;
      let totalFees = 0;
      let totalNet = 0;

      for (const s of settlements) {
        totalGross += s.grossAmount;
        totalFees += s.totalFees;
        totalNet += s.netAmount;
        rows.push(toCsvRow([
          s.id, s.merchantAccountId,
          s.periodStart.toISOString(), s.periodEnd.toISOString(),
          s.grossAmount, s.totalFees, s.totalRefunds, s.totalChargebacks,
          s.netAmount, s.currency, s.status,
        ]));
      }

      const summary = { totalSettlements: settlements.length, totalGross, totalFees, totalNet };
      const summaryRows = [
        `# Settlement Report — ${dateRange.start.toISOString()} to ${dateRange.end.toISOString()}`,
        `# Total Settlements: ${summary.totalSettlements}`,
        `# Gross: ${totalGross} | Fees: ${totalFees} | Net: ${totalNet}`,
        "",
      ];

      await prisma.reportJob.update({
        where: { id: jobId },
        data: {
          status: "completed",
          completedAt: new Date(),
          reportData: [...summaryRows, ...rows].join("\n"),
          rowCount: settlements.length,
          summary,
        },
      });
    } catch (error) {
      await prisma.reportJob.update({
        where: { id: jobId },
        data: { status: "failed", error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  async function processDisputeReport(jobId: string, dateRange: DateRange): Promise<void> {
    await prisma.reportJob.update({
      where: { id: jobId },
      data: { status: "processing", startedAt: new Date() },
    });

    try {
      const disputes = await prisma.dispute.findMany({
        where: {
          tenantId,
          filedAt: { gte: dateRange.start, lte: dateRange.end },
        },
        orderBy: { filedAt: "desc" },
      });

      const rows: string[] = [];
      rows.push(toCsvRow(["Dispute ID", "Payment ID", "Type", "Reason", "Status", "Amount", "Currency", "Filed At", "Outcome"]));

      let totalAmount = 0;
      let wonCount = 0;
      let lostCount = 0;

      for (const d of disputes) {
        totalAmount += d.amount;
        if (d.outcome === "won") wonCount++;
        if (d.outcome === "lost") lostCount++;
        rows.push(toCsvRow([
          d.id, d.paymentId, d.type, d.reason, d.status,
          d.amount, d.currency, d.filedAt.toISOString(), d.outcome ?? "pending",
        ]));
      }

      const summary = {
        totalDisputes: disputes.length,
        totalAmount,
        wonCount,
        lostCount,
        winRate: disputes.length > 0 ? Math.round((wonCount / disputes.length) * 10000) / 100 : 0,
      };
      const summaryRows = [
        `# Dispute Report — ${dateRange.start.toISOString()} to ${dateRange.end.toISOString()}`,
        `# Total Disputes: ${summary.totalDisputes} | Won: ${wonCount} | Lost: ${lostCount}`,
        `# Total Disputed Amount: ${totalAmount}`,
        "",
      ];

      await prisma.reportJob.update({
        where: { id: jobId },
        data: {
          status: "completed",
          completedAt: new Date(),
          reportData: [...summaryRows, ...rows].join("\n"),
          rowCount: disputes.length,
          summary,
        },
      });
    } catch (error) {
      await prisma.reportJob.update({
        where: { id: jobId },
        data: { status: "failed", error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  async function processRevenueReport(jobId: string, dateRange: DateRange): Promise<void> {
    await prisma.reportJob.update({
      where: { id: jobId },
      data: { status: "processing", startedAt: new Date() },
    });

    try {
      // Get payment events for GPV
      const paymentEvents = await prisma.eventStore.findMany({
        where: {
          tenantId,
          eventType: "PaymentCompleted",
          createdAt: { gte: dateRange.start, lte: dateRange.end },
        },
      });

      // Get refund events
      const refundEvents = await prisma.eventStore.findMany({
        where: {
          tenantId,
          eventType: "PaymentRefunded",
          createdAt: { gte: dateRange.start, lte: dateRange.end },
        },
      });

      // Get fee entries from ledger
      const feeAccounts = await prisma.ledgerAccount.findMany({
        where: { tenantId, name: "platform_fees" },
        select: { id: true },
      });
      const feeAccountIds = feeAccounts.map((a) => a.id);
      const feeEntries = await prisma.ledgerEntry.findMany({
        where: {
          tenantId,
          accountId: { in: feeAccountIds },
          direction: "credit",
          effectiveAt: { gte: dateRange.start, lte: dateRange.end },
        },
      });

      const gpv = paymentEvents.reduce((sum, e) => {
        const payload = e.payload as Record<string, unknown>;
        return sum + (typeof payload["amount"] === "number" ? payload["amount"] : 0);
      }, 0);

      const refunds = refundEvents.reduce((sum, e) => {
        const payload = e.payload as Record<string, unknown>;
        return sum + (typeof payload["amount"] === "number" ? payload["amount"] : 0);
      }, 0);

      const fees = feeEntries.reduce((sum, e) => sum + e.amount, 0);
      const netRevenue = gpv - refunds;

      const rows: string[] = [];
      rows.push(toCsvRow(["Metric", "Value", "Currency"]));
      rows.push(toCsvRow(["Gross Payment Volume", gpv, "USD"]));
      rows.push(toCsvRow(["Total Refunds", refunds, "USD"]));
      rows.push(toCsvRow(["Platform Fees", fees, "USD"]));
      rows.push(toCsvRow(["Net Revenue", netRevenue, "USD"]));
      rows.push(toCsvRow(["Total Transactions", paymentEvents.length, ""]));
      rows.push(toCsvRow(["Total Refunds Count", refundEvents.length, ""]));

      const summary = { gpv, refunds, fees, netRevenue, transactionCount: paymentEvents.length, refundCount: refundEvents.length };
      const summaryRows = [
        `# Revenue Report — ${dateRange.start.toISOString()} to ${dateRange.end.toISOString()}`,
        `# GPV: ${gpv} | Refunds: ${refunds} | Fees: ${fees} | Net: ${netRevenue}`,
        "",
      ];

      await prisma.reportJob.update({
        where: { id: jobId },
        data: {
          status: "completed",
          completedAt: new Date(),
          reportData: [...summaryRows, ...rows].join("\n"),
          rowCount: rows.length - 1,
          summary,
        },
      });
    } catch (error) {
      await prisma.reportJob.update({
        where: { id: jobId },
        data: { status: "failed", error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  return {
    async generateTransactionReport(filters) {
      try {
        const format = filters.format ?? "csv";
        const job = await createJob("transaction", filters.dateRange, {
          status: filters.status,
          providerId: filters.providerId,
          customerId: filters.customerId,
        }, format);

        // Process async (fire-and-forget)
        processTransactionReport(job.id, filters.dateRange, {
          status: filters.status,
          customerId: filters.customerId,
        }).catch(() => { /* logged inside */ });

        return ok(job);
      } catch (error) {
        return err(new ReportError(
          `Failed to create report: ${error instanceof Error ? error.message : String(error)}`,
          "GENERATION_FAILED",
        ));
      }
    },

    async generateSettlementReport(period) {
      try {
        const job = await createJob("settlement", period, {}, "csv");
        processSettlementReport(job.id, period).catch(() => {});
        return ok(job);
      } catch (error) {
        return err(new ReportError(
          `Failed to create report: ${error instanceof Error ? error.message : String(error)}`,
          "GENERATION_FAILED",
        ));
      }
    },

    async generateDisputeReport(dateRange) {
      try {
        const job = await createJob("dispute", dateRange, {}, "csv");
        processDisputeReport(job.id, dateRange).catch(() => {});
        return ok(job);
      } catch (error) {
        return err(new ReportError(
          `Failed to create report: ${error instanceof Error ? error.message : String(error)}`,
          "GENERATION_FAILED",
        ));
      }
    },

    async generateRevenueReport(dateRange) {
      try {
        const job = await createJob("revenue", dateRange, {}, "csv");
        processRevenueReport(job.id, dateRange).catch(() => {});
        return ok(job);
      } catch (error) {
        return err(new ReportError(
          `Failed to create report: ${error instanceof Error ? error.message : String(error)}`,
          "GENERATION_FAILED",
        ));
      }
    },

    async getReport(reportId) {
      try {
        const record = await prisma.reportJob.findFirst({
          where: { id: reportId, tenantId },
        });
        if (!record) return err(new ReportError(`Report ${reportId} not found`, "NOT_FOUND"));
        return ok(toReportJob(record));
      } catch (error) {
        return err(new ReportError(
          `Failed to get report: ${error instanceof Error ? error.message : String(error)}`,
          "GENERATION_FAILED",
        ));
      }
    },

    async getReportData(reportId) {
      try {
        const record = await prisma.reportJob.findFirst({
          where: { id: reportId, tenantId },
        });
        if (!record) return err(new ReportError(`Report ${reportId} not found`, "NOT_FOUND"));
        if (record.status !== "completed" || !record.reportData) {
          return err(new ReportError(`Report ${reportId} is not ready (status: ${record.status})`, "NOT_FOUND"));
        }
        return ok(record.reportData);
      } catch (error) {
        return err(new ReportError(
          `Failed to get report data: ${error instanceof Error ? error.message : String(error)}`,
          "GENERATION_FAILED",
        ));
      }
    },

    async listReports() {
      try {
        const records = await prisma.reportJob.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        return ok(records.map(toReportJob));
      } catch (error) {
        return err(new ReportError(
          `Failed to list reports: ${error instanceof Error ? error.message : String(error)}`,
          "GENERATION_FAILED",
        ));
      }
    },
  };
}

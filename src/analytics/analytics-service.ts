import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type TimeWindowName = "1h" | "24h" | "7d" | "30d" | "90d" | "custom";

export interface TimeWindow {
  name: TimeWindowName;
  start: Date;
  end: Date;
}

export interface MetricSnapshot {
  id: string;
  tenantId: string;
  merchantAccountId: string | null;
  providerId: string | null;
  metricName: string;
  value: number;
  periodStart: string;
  periodEnd: string;
  computedAt: string;
}

export interface MetricFilters {
  metricName?: string | undefined;
  providerId?: string | undefined;
  merchantAccountId?: string | undefined;
  windowName?: TimeWindowName | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  limit?: number | undefined;
}

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

export interface WindowComparison {
  metricName: string;
  current: { value: number; periodStart: string; periodEnd: string };
  previous: { value: number; periodStart: string; periodEnd: string };
  changePercent: number;
  improved: boolean;
}

// ── Error ────────────────────────────────────────────────────────────────────

export class AnalyticsError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "COMPUTATION_FAILED" | "VALIDATION",
  ) {
    super(message);
    this.name = "AnalyticsError";
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

const WINDOW_DURATIONS_MS: Record<Exclude<TimeWindowName, "custom">, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
  "90d": 7_776_000_000,
};

// ── Service Interface ────────────────────────────────────────────────────────

export interface AnalyticsService {
  computeMetrics(window: TimeWindow): Promise<Result<MetricSnapshot[], AnalyticsError>>;
  getMetrics(filters: MetricFilters): Promise<Result<MetricSnapshot[], AnalyticsError>>;
  getTimeSeries(metricName: string, from: Date, to: Date, granularity: string): Promise<Result<TimeSeriesPoint[], AnalyticsError>>;
  compareWindows(metricName: string, current: TimeWindow, previous: TimeWindow): Promise<Result<WindowComparison, AnalyticsError>>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function buildTimeWindow(name: Exclude<TimeWindowName, "custom">, now?: Date): TimeWindow {
  const end = now ?? new Date();
  const start = new Date(end.getTime() - WINDOW_DURATIONS_MS[name]);
  return { name, start, end };
}

function toSnapshot(record: {
  id: string;
  tenantId: string;
  merchantAccountId: string | null;
  providerId: string | null;
  metricName: string;
  value: number;
  periodStart: Date;
  periodEnd: Date;
  computedAt: Date;
}): MetricSnapshot {
  return {
    id: record.id,
    tenantId: record.tenantId,
    merchantAccountId: record.merchantAccountId,
    providerId: record.providerId,
    metricName: record.metricName,
    value: record.value,
    periodStart: record.periodStart.toISOString(),
    periodEnd: record.periodEnd.toISOString(),
    computedAt: record.computedAt.toISOString(),
  };
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createAnalyticsService(
  prisma: PrismaClient,
  tenantId: string,
): AnalyticsService {

  async function computeProviderMetrics(
    window: TimeWindow,
  ): Promise<{ provider: string; total: number; successes: number; failures: number; avgLatency: number }[]> {
    const records = await prisma.providerMetric.findMany({
      where: {
        tenantId,
        createdAt: { gte: window.start, lte: window.end },
      },
    });

    const grouped = new Map<string, typeof records>();
    for (const r of records) {
      const list = grouped.get(r.provider) ?? [];
      list.push(r);
      grouped.set(r.provider, list);
    }

    const results: { provider: string; total: number; successes: number; failures: number; avgLatency: number }[] = [];
    for (const [provider, recs] of grouped) {
      const successes = recs.filter((r) => r.outcome === "success").length;
      const failures = recs.length - successes;
      const totalLatency = recs.reduce((sum, r) => sum + r.latencyMs, 0);
      results.push({
        provider,
        total: recs.length,
        successes,
        failures,
        avgLatency: recs.length > 0 ? Math.round(totalLatency / recs.length) : 0,
      });
    }
    return results;
  }

  async function computePaymentMetrics(
    window: TimeWindow,
  ): Promise<{
    totalPayments: number;
    completedPayments: number;
    failedPayments: number;
    totalAmount: number;
    refundCount: number;
    refundAmount: number;
    disputeCount: number;
    feeAmount: number;
  }> {
    const events = await prisma.eventStore.findMany({
      where: {
        tenantId,
        createdAt: { gte: window.start, lte: window.end },
        eventType: {
          in: [
            "PaymentInitiated",
            "PaymentCompleted",
            "PaymentFailed",
            "PaymentRefunded",
            "DisputeReceived",
          ],
        },
      },
      select: { eventType: true, payload: true },
    });

    let totalPayments = 0;
    let completedPayments = 0;
    let failedPayments = 0;
    let totalAmount = 0;
    let refundCount = 0;
    let refundAmount = 0;
    let disputeCount = 0;

    for (const e of events) {
      const payload = e.payload as Record<string, unknown>;
      const amount = typeof payload["amount"] === "number" ? payload["amount"] : 0;

      switch (e.eventType) {
        case "PaymentInitiated":
          totalPayments++;
          totalAmount += amount;
          break;
        case "PaymentCompleted":
          completedPayments++;
          break;
        case "PaymentFailed":
          failedPayments++;
          break;
        case "PaymentRefunded":
          refundCount++;
          refundAmount += amount;
          break;
        case "DisputeReceived":
          disputeCount++;
          break;
      }
    }

    // Estimate fees from ledger entries in the window
    const feeEntries = await prisma.ledgerEntry.findMany({
      where: {
        tenantId,
        effectiveAt: { gte: window.start, lte: window.end },
        direction: "credit",
      },
    });

    // Sum credits to platform_fees account
    let feeAmount = 0;
    const feeAccounts = await prisma.ledgerAccount.findMany({
      where: { tenantId, name: "platform_fees" },
      select: { id: true },
    });
    const feeAccountIds = new Set(feeAccounts.map((a) => a.id));
    for (const entry of feeEntries) {
      if (feeAccountIds.has(entry.accountId)) {
        feeAmount += entry.amount;
      }
    }

    return {
      totalPayments,
      completedPayments,
      failedPayments,
      totalAmount,
      refundCount,
      refundAmount,
      disputeCount,
      feeAmount,
    };
  }

  async function upsertMetric(
    metricName: string,
    value: number,
    window: TimeWindow,
    providerId: string | null,
    merchantAccountId: string | null,
  ): Promise<MetricSnapshot> {
    const record = await prisma.paymentMetricSnapshot.create({
      data: {
        id: uuid(),
        tenantId,
        merchantAccountId,
        providerId,
        metricName,
        value,
        periodStart: window.start,
        periodEnd: window.end,
      },
    });
    return toSnapshot(record);
  }

  return {
    async computeMetrics(window) {
      try {
        const [providerStats, paymentStats] = await Promise.all([
          computeProviderMetrics(window),
          computePaymentMetrics(window),
        ]);

        const snapshots: MetricSnapshot[] = [];

        // Authorization rate (overall)
        const authRate = paymentStats.totalPayments > 0
          ? paymentStats.completedPayments / paymentStats.totalPayments
          : 0;
        snapshots.push(await upsertMetric("authorization_rate", Math.round(authRate * 10000) / 10000, window, null, null));

        // Capture rate (same as auth rate in this model since capture = completion)
        snapshots.push(await upsertMetric("capture_rate", Math.round(authRate * 10000) / 10000, window, null, null));

        // Decline rate
        const declineRate = paymentStats.totalPayments > 0
          ? paymentStats.failedPayments / paymentStats.totalPayments
          : 0;
        snapshots.push(await upsertMetric("decline_rate", Math.round(declineRate * 10000) / 10000, window, null, null));

        // Average transaction value
        const avgTxValue = paymentStats.totalPayments > 0
          ? Math.round(paymentStats.totalAmount / paymentStats.totalPayments)
          : 0;
        snapshots.push(await upsertMetric("avg_transaction_value", avgTxValue, window, null, null));

        // Gross payment volume
        snapshots.push(await upsertMetric("gross_payment_volume", paymentStats.totalAmount, window, null, null));

        // Net revenue (GPV - refunds - fees approximation)
        const netRevenue = paymentStats.totalAmount - paymentStats.refundAmount - paymentStats.feeAmount;
        snapshots.push(await upsertMetric("net_revenue", netRevenue, window, null, null));

        // Refund rate
        const refundRate = paymentStats.completedPayments > 0
          ? paymentStats.refundCount / paymentStats.completedPayments
          : 0;
        snapshots.push(await upsertMetric("refund_rate", Math.round(refundRate * 10000) / 10000, window, null, null));

        // Chargeback rate
        const chargebackRate = paymentStats.completedPayments > 0
          ? paymentStats.disputeCount / paymentStats.completedPayments
          : 0;
        snapshots.push(await upsertMetric("chargeback_rate", Math.round(chargebackRate * 10000) / 10000, window, null, null));

        // Per-provider metrics
        for (const stats of providerStats) {
          const providerAuthRate = stats.total > 0 ? stats.successes / stats.total : 0;
          snapshots.push(await upsertMetric(
            "authorization_rate",
            Math.round(providerAuthRate * 10000) / 10000,
            window,
            stats.provider,
            null,
          ));

          const providerDeclineRate = stats.total > 0 ? stats.failures / stats.total : 0;
          snapshots.push(await upsertMetric(
            "decline_rate",
            Math.round(providerDeclineRate * 10000) / 10000,
            window,
            stats.provider,
            null,
          ));

          snapshots.push(await upsertMetric(
            "avg_latency",
            stats.avgLatency,
            window,
            stats.provider,
            null,
          ));
        }

        return ok(snapshots);
      } catch (error) {
        return err(new AnalyticsError(
          `Failed to compute metrics: ${error instanceof Error ? error.message : String(error)}`,
          "COMPUTATION_FAILED",
        ));
      }
    },

    async getMetrics(filters) {
      try {
        const where: Record<string, unknown> = { tenantId };

        if (filters.metricName) where["metricName"] = filters.metricName;
        if (filters.providerId) where["providerId"] = filters.providerId;
        if (filters.merchantAccountId) where["merchantAccountId"] = filters.merchantAccountId;

        if (filters.windowName && filters.windowName !== "custom") {
          const window = buildTimeWindow(filters.windowName);
          where["periodEnd"] = { gte: window.start, lte: window.end };
        } else if (filters.from || filters.to) {
          const dateFilter: Record<string, Date> = {};
          if (filters.from) dateFilter["gte"] = filters.from;
          if (filters.to) dateFilter["lte"] = filters.to;
          where["periodEnd"] = dateFilter;
        }

        const records = await prisma.paymentMetricSnapshot.findMany({
          where,
          orderBy: { computedAt: "desc" },
          take: filters.limit ?? 100,
        });

        return ok(records.map(toSnapshot));
      } catch (error) {
        return err(new AnalyticsError(
          `Failed to get metrics: ${error instanceof Error ? error.message : String(error)}`,
          "COMPUTATION_FAILED",
        ));
      }
    },

    async getTimeSeries(metricName, from, to, _granularity) {
      try {
        const records = await prisma.paymentMetricSnapshot.findMany({
          where: {
            tenantId,
            metricName,
            periodEnd: { gte: from, lte: to },
            providerId: null,
            merchantAccountId: null,
          },
          orderBy: { periodEnd: "asc" },
        });

        const points: TimeSeriesPoint[] = records.map((r) => ({
          timestamp: r.periodEnd.toISOString(),
          value: r.value,
        }));

        return ok(points);
      } catch (error) {
        return err(new AnalyticsError(
          `Failed to get time series: ${error instanceof Error ? error.message : String(error)}`,
          "COMPUTATION_FAILED",
        ));
      }
    },

    async compareWindows(metricName, current, previous) {
      try {
        const [currentRecords, previousRecords] = await Promise.all([
          prisma.paymentMetricSnapshot.findMany({
            where: {
              tenantId,
              metricName,
              periodEnd: { gte: current.start, lte: current.end },
              providerId: null,
              merchantAccountId: null,
            },
            orderBy: { computedAt: "desc" },
            take: 1,
          }),
          prisma.paymentMetricSnapshot.findMany({
            where: {
              tenantId,
              metricName,
              periodEnd: { gte: previous.start, lte: previous.end },
              providerId: null,
              merchantAccountId: null,
            },
            orderBy: { computedAt: "desc" },
            take: 1,
          }),
        ]);

        const currentValue = currentRecords[0]?.value ?? 0;
        const previousValue = previousRecords[0]?.value ?? 0;

        const changePercent = previousValue !== 0
          ? Math.round(((currentValue - previousValue) / previousValue) * 10000) / 100
          : 0;

        // For rates (auth, capture) higher is better; for decline/refund/chargeback lower is better
        const higherIsBetter = ["authorization_rate", "capture_rate", "gross_payment_volume", "net_revenue", "avg_transaction_value"].includes(metricName);
        const improved = higherIsBetter ? changePercent > 0 : changePercent < 0;

        return ok({
          metricName,
          current: {
            value: currentValue,
            periodStart: current.start.toISOString(),
            periodEnd: current.end.toISOString(),
          },
          previous: {
            value: previousValue,
            periodStart: previous.start.toISOString(),
            periodEnd: previous.end.toISOString(),
          },
          changePercent,
          improved,
        });
      } catch (error) {
        return err(new AnalyticsError(
          `Failed to compare windows: ${error instanceof Error ? error.message : String(error)}`,
          "COMPUTATION_FAILED",
        ));
      }
    },
  };
}

import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";

export interface ProviderMetricRecord {
  provider: string;
  outcome: "success" | "failure" | "timeout";
  latencyMs: number;
  declineCode?: string | undefined;
  amount: number;
  currency: string;
}

export interface ProviderStats {
  provider: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

export class ProviderMetricsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderMetricsError";
  }
}

export interface ProviderMetrics {
  record(metric: ProviderMetricRecord): Promise<Result<void, ProviderMetricsError>>;
  getSuccessRate(provider: string, windowMs: number): Promise<Result<number, ProviderMetricsError>>;
  getStats(provider: string, windowMs: number): Promise<Result<ProviderStats, ProviderMetricsError>>;
  getAllStats(windowMs: number): Promise<Result<ProviderStats[], ProviderMetricsError>>;
}

export function createProviderMetrics(prisma: PrismaClient): ProviderMetrics {
  return {
    async record(metric) {
      try {
        await prisma.providerMetric.create({
          data: {
            id: uuid(),
            provider: metric.provider,
            outcome: metric.outcome,
            latencyMs: metric.latencyMs,
            declineCode: metric.declineCode ?? null,
            amount: metric.amount,
            currency: metric.currency,
          },
        });
        return ok(undefined);
      } catch (error) {
        return err(new ProviderMetricsError(
          `Failed to record metric: ${error instanceof Error ? error.message : String(error)}`,
        ));
      }
    },

    async getSuccessRate(provider, windowMs) {
      try {
        const since = new Date(Date.now() - windowMs);
        const total = await prisma.providerMetric.count({
          where: { provider, createdAt: { gte: since } },
        });
        if (total === 0) return ok(1.0);
        const successes = await prisma.providerMetric.count({
          where: { provider, outcome: "success", createdAt: { gte: since } },
        });
        return ok(successes / total);
      } catch (error) {
        return err(new ProviderMetricsError(
          `Failed to query success rate: ${error instanceof Error ? error.message : String(error)}`,
        ));
      }
    },

    async getStats(provider, windowMs) {
      try {
        const since = new Date(Date.now() - windowMs);
        const records = await prisma.providerMetric.findMany({
          where: { provider, createdAt: { gte: since } },
          orderBy: { latencyMs: "asc" },
        });
        return ok(computeStats(provider, records));
      } catch (error) {
        return err(new ProviderMetricsError(
          `Failed to query stats: ${error instanceof Error ? error.message : String(error)}`,
        ));
      }
    },

    async getAllStats(windowMs) {
      try {
        const since = new Date(Date.now() - windowMs);
        const records = await prisma.providerMetric.findMany({
          where: { createdAt: { gte: since } },
          orderBy: { latencyMs: "asc" },
        });

        const grouped = new Map<string, typeof records>();
        for (const r of records) {
          const list = grouped.get(r.provider) ?? [];
          list.push(r);
          grouped.set(r.provider, list);
        }

        const stats: ProviderStats[] = [];
        for (const [name, recs] of grouped) {
          stats.push(computeStats(name, recs));
        }
        return ok(stats);
      } catch (error) {
        return err(new ProviderMetricsError(
          `Failed to query all stats: ${error instanceof Error ? error.message : String(error)}`,
        ));
      }
    },
  };
}

function computeStats(
  provider: string,
  records: { outcome: string; latencyMs: number }[],
): ProviderStats {
  if (records.length === 0) {
    return {
      provider,
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 1.0,
      avgLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
    };
  }

  const successCount = records.filter((r) => r.outcome === "success").length;
  const failureCount = records.length - successCount;
  const latencies = records.map((r) => r.latencyMs).sort((a, b) => a - b);
  const sum = latencies.reduce((s, v) => s + v, 0);

  return {
    provider,
    totalRequests: records.length,
    successCount,
    failureCount,
    successRate: successCount / records.length,
    avgLatencyMs: Math.round(sum / records.length),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

import type { PrismaClient } from "@prisma/client";
import type { CircuitBreakerRegistry } from "../circuit-breaker/circuit-breaker-registry.js";
import type { QueueService } from "../queue/queue-service.js";
import type { CacheService } from "../cache/cache-service.js";
import { ALL_QUEUE_NAMES } from "../queue/queue-service.js";

const APP_VERSION = "2.0.0";
let startTime: number = Date.now();

export interface SubsystemCheck {
  status: "up" | "down";
  latencyMs: number;
  error?: string | undefined;
}

export interface ProviderCheck {
  status: "up" | "degraded" | "down";
  circuitBreaker: "closed" | "half-open" | "open";
}

export interface QueueCheck {
  depth: number;
  processing: number;
}

export interface LivenessResult {
  status: "ok";
  timestamp: string;
}

export interface ReadinessResult {
  status: "healthy" | "degraded" | "unhealthy";
  checks: {
    database: SubsystemCheck;
    redis: SubsystemCheck;
    providers: Record<string, ProviderCheck>;
    queues: Record<string, QueueCheck>;
  };
  version: string;
  uptime: string;
}

export interface HealthService {
  liveness(): LivenessResult;
  readiness(): Promise<ReadinessResult>;
  setStartTime(time: number): void;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60) % 60;
  const hours = Math.floor(seconds / 3600) % 24;
  const days = Math.floor(seconds / 86400);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

export function createHealthService(deps: {
  prisma: PrismaClient;
  cbRegistry: CircuitBreakerRegistry;
  queueService?: QueueService | undefined;
  cacheService?: CacheService | undefined;
}): HealthService {
  const { prisma, cbRegistry, queueService, cacheService } = deps;

  return {
    liveness() {
      return { status: "ok", timestamp: new Date().toISOString() };
    },

    async readiness() {
      // Database check
      let dbCheck: SubsystemCheck;
      const dbStart = Date.now();
      try {
        await prisma.$queryRaw`SELECT 1`;
        dbCheck = { status: "up", latencyMs: Date.now() - dbStart };
      } catch (error) {
        dbCheck = {
          status: "down",
          latencyMs: Date.now() - dbStart,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }

      // Redis check
      let redisCheck: SubsystemCheck;
      const redisStart = Date.now();
      if (cacheService) {
        try {
          const available = await cacheService.isAvailable();
          redisCheck = {
            status: available ? "up" : "down",
            latencyMs: Date.now() - redisStart,
            ...(available ? {} : { error: "Redis not responding" }),
          };
        } catch (error) {
          redisCheck = {
            status: "down",
            latencyMs: Date.now() - redisStart,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      } else {
        redisCheck = { status: "down", latencyMs: 0, error: "Redis not configured" };
      }

      // Provider checks (circuit breaker state)
      const providers: Record<string, ProviderCheck> = {};
      const providerNames = ["stripe", "adyen", "paypal"];
      for (const name of providerNames) {
        const breaker = cbRegistry.get(name);
        if (breaker) {
          const state = breaker.getState();
          let status: ProviderCheck["status"] = "up";
          if (state === "open") status = "down";
          else if (state === "half-open") status = "degraded";
          providers[name] = { status, circuitBreaker: state };
        } else {
          providers[name] = { status: "up", circuitBreaker: "closed" };
        }
      }

      // Queue checks
      const queueChecks: Record<string, QueueCheck> = {};
      if (queueService) {
        try {
          const stats = await queueService.getQueueStats();
          for (const stat of stats) {
            queueChecks[stat.name] = {
              depth: stat.waiting + stat.delayed,
              processing: stat.active,
            };
          }
        } catch {
          for (const name of ALL_QUEUE_NAMES) {
            queueChecks[name] = { depth: 0, processing: 0 };
          }
        }
      }

      // Determine overall status
      let status: ReadinessResult["status"] = "healthy";
      if (dbCheck.status === "down") {
        status = "unhealthy";
      } else if (redisCheck.status === "down" && cacheService) {
        status = "degraded";
      }

      const hasOpenProvider = Object.values(providers).some((p) => p.status === "down");
      const hasDegradedProvider = Object.values(providers).some((p) => p.status === "degraded");
      if (hasOpenProvider && status !== "unhealthy") status = "degraded";
      else if (hasDegradedProvider && status === "healthy") status = "degraded";

      return {
        status,
        checks: {
          database: dbCheck,
          redis: redisCheck,
          providers,
          queues: queueChecks,
        },
        version: APP_VERSION,
        uptime: formatUptime(Date.now() - startTime),
      };
    },

    setStartTime(time: number) {
      startTime = time;
    },
  };
}

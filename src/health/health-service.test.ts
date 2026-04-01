import { describe, it, expect, vi } from "vitest";
import { createHealthService, type HealthService } from "./health-service.js";

function createMockPrisma() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  } as unknown as import("@prisma/client").PrismaClient;
}

function createMockCbRegistry() {
  const breakers = new Map<string, { getState: () => string }>();
  return {
    get(name: string) {
      return breakers.get(name) ?? null;
    },
    create(config: { name: string }) {
      const breaker = { getState: () => "closed" as string };
      breakers.set(config.name, breaker);
      return breaker;
    },
    getAll() {
      return Array.from(breakers.entries()).map(([name, b]) => ({ name, state: b.getState() }));
    },
    _setBreaker(name: string, state: string) {
      breakers.set(name, { getState: () => state });
    },
  } as unknown as import("../circuit-breaker/circuit-breaker-registry.js").CircuitBreakerRegistry & {
    _setBreaker: (name: string, state: string) => void;
  };
}

describe("HealthService", () => {
  describe("liveness", () => {
    it("returns ok status", () => {
      const service = createHealthService({
        prisma: createMockPrisma(),
        cbRegistry: createMockCbRegistry(),
      });
      const result = service.liveness();
      expect(result.status).toBe("ok");
      expect(result.timestamp).toBeTruthy();
    });

    it("includes ISO timestamp", () => {
      const service = createHealthService({
        prisma: createMockPrisma(),
        cbRegistry: createMockCbRegistry(),
      });
      const result = service.liveness();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });

  describe("readiness", () => {
    it("returns healthy when all checks pass", async () => {
      const cbRegistry = createMockCbRegistry();
      cbRegistry._setBreaker("stripe", "closed");
      cbRegistry._setBreaker("adyen", "closed");
      cbRegistry._setBreaker("paypal", "closed");

      const service = createHealthService({
        prisma: createMockPrisma(),
        cbRegistry,
      });

      const result = await service.readiness();
      expect(result.status).toBe("healthy");
      expect(result.checks.database.status).toBe("up");
      expect(result.version).toBe("2.0.0");
      expect(result.uptime).toBeTruthy();
    });

    it("returns unhealthy when database is down", async () => {
      const prisma = createMockPrisma();
      (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Connection refused"));

      const service = createHealthService({
        prisma,
        cbRegistry: createMockCbRegistry(),
      });

      const result = await service.readiness();
      expect(result.status).toBe("unhealthy");
      expect(result.checks.database.status).toBe("down");
      expect(result.checks.database.error).toContain("Connection refused");
    });

    it("reports provider status from circuit breaker state", async () => {
      const cbRegistry = createMockCbRegistry();
      cbRegistry._setBreaker("stripe", "closed");
      cbRegistry._setBreaker("adyen", "half-open");
      cbRegistry._setBreaker("paypal", "open");

      const service = createHealthService({
        prisma: createMockPrisma(),
        cbRegistry,
      });

      const result = await service.readiness();
      expect(result.checks.providers["stripe"]!.status).toBe("up");
      expect(result.checks.providers["stripe"]!.circuitBreaker).toBe("closed");
      expect(result.checks.providers["adyen"]!.status).toBe("degraded");
      expect(result.checks.providers["adyen"]!.circuitBreaker).toBe("half-open");
      expect(result.checks.providers["paypal"]!.status).toBe("down");
      expect(result.checks.providers["paypal"]!.circuitBreaker).toBe("open");
    });

    it("returns degraded when a provider circuit is open", async () => {
      const cbRegistry = createMockCbRegistry();
      cbRegistry._setBreaker("stripe", "open");
      cbRegistry._setBreaker("adyen", "closed");
      cbRegistry._setBreaker("paypal", "closed");

      const service = createHealthService({
        prisma: createMockPrisma(),
        cbRegistry,
      });

      const result = await service.readiness();
      expect(result.status).toBe("degraded");
    });

    it("returns degraded when a provider is half-open", async () => {
      const cbRegistry = createMockCbRegistry();
      cbRegistry._setBreaker("stripe", "closed");
      cbRegistry._setBreaker("adyen", "half-open");
      cbRegistry._setBreaker("paypal", "closed");

      const service = createHealthService({
        prisma: createMockPrisma(),
        cbRegistry,
      });

      const result = await service.readiness();
      expect(result.status).toBe("degraded");
    });

    it("reports redis as down when not configured", async () => {
      const service = createHealthService({
        prisma: createMockPrisma(),
        cbRegistry: createMockCbRegistry(),
      });

      const result = await service.readiness();
      expect(result.checks.redis.status).toBe("down");
      expect(result.checks.redis.error).toBe("Redis not configured");
    });

    it("reports redis status from cache service", async () => {
      const mockCache = {
        isAvailable: vi.fn().mockResolvedValue(true),
      } as unknown as import("../cache/cache-service.js").CacheService;

      const service = createHealthService({
        prisma: createMockPrisma(),
        cbRegistry: createMockCbRegistry(),
        cacheService: mockCache,
      });

      const result = await service.readiness();
      expect(result.checks.redis.status).toBe("up");
    });

    it("database check includes latency", async () => {
      const service = createHealthService({
        prisma: createMockPrisma(),
        cbRegistry: createMockCbRegistry(),
      });

      const result = await service.readiness();
      expect(result.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("formats uptime correctly", async () => {
      const service = createHealthService({
        prisma: createMockPrisma(),
        cbRegistry: createMockCbRegistry(),
      });

      // Set start time to 1 day, 2 hours, and 30 minutes ago
      service.setStartTime(Date.now() - (1 * 86400000 + 2 * 3600000 + 30 * 60000));

      const result = await service.readiness();
      expect(result.uptime).toContain("1d");
      expect(result.uptime).toContain("2h");
      expect(result.uptime).toContain("30m");
    });
  });
});

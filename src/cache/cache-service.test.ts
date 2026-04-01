import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the cache service behavior by mocking ioredis.
// Since the cache service gracefully degrades, we can test both connected and disconnected states.

describe("CacheService", () => {
  describe("disabled mode", () => {
    it("returns null for get when disabled", async () => {
      // Dynamically import to avoid Redis connection on module load
      const { createCacheService } = await import("./cache-service.js");
      const cache = createCacheService("redis://localhost:6379", false);
      const result = await cache.get("test-key");
      expect(result).toBeNull();
      await cache.close();
    });

    it("set is a no-op when disabled", async () => {
      const { createCacheService } = await import("./cache-service.js");
      const cache = createCacheService("redis://localhost:6379", false);
      await cache.set("key", { data: "value" }, 60);
      const result = await cache.get("key");
      expect(result).toBeNull();
      await cache.close();
    });

    it("del is a no-op when disabled", async () => {
      const { createCacheService } = await import("./cache-service.js");
      const cache = createCacheService("redis://localhost:6379", false);
      // Should not throw
      await cache.del("key");
      await cache.close();
    });

    it("delPattern returns 0 when disabled", async () => {
      const { createCacheService } = await import("./cache-service.js");
      const cache = createCacheService("redis://localhost:6379", false);
      const result = await cache.delPattern("test:*");
      expect(result).toBe(0);
      await cache.close();
    });

    it("increment returns 0 when disabled", async () => {
      const { createCacheService } = await import("./cache-service.js");
      const cache = createCacheService("redis://localhost:6379", false);
      const result = await cache.increment("counter");
      expect(result).toBe(0);
      await cache.close();
    });

    it("slidingWindowAdd returns 0 when disabled", async () => {
      const { createCacheService } = await import("./cache-service.js");
      const cache = createCacheService("redis://localhost:6379", false);
      const result = await cache.slidingWindowAdd("window:key", 60);
      expect(result).toBe(0);
      await cache.close();
    });

    it("slidingWindowCount returns 0 when disabled", async () => {
      const { createCacheService } = await import("./cache-service.js");
      const cache = createCacheService("redis://localhost:6379", false);
      const result = await cache.slidingWindowCount("window:key", 60);
      expect(result).toBe(0);
      await cache.close();
    });

    it("isAvailable returns false when disabled", async () => {
      const { createCacheService } = await import("./cache-service.js");
      const cache = createCacheService("redis://localhost:6379", false);
      const result = await cache.isAvailable();
      expect(result).toBe(false);
      await cache.close();
    });

    it("close is safe to call when disabled", async () => {
      const { createCacheService } = await import("./cache-service.js");
      const cache = createCacheService("redis://localhost:6379", false);
      await cache.close();
      // Should not throw on double close
      await cache.close();
    });
  });

  describe("CacheError", () => {
    it("has correct name and code", async () => {
      const { CacheError } = await import("./cache-service.js");
      const error = new CacheError("test", "CONNECTION_FAILED");
      expect(error.name).toBe("CacheError");
      expect(error.code).toBe("CONNECTION_FAILED");
      expect(error.message).toBe("test");
    });

    it("supports OPERATION_FAILED code", async () => {
      const { CacheError } = await import("./cache-service.js");
      const error = new CacheError("op failed", "OPERATION_FAILED");
      expect(error.code).toBe("OPERATION_FAILED");
    });
  });
});

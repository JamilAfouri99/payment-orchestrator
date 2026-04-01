import Redis from "ioredis";

export class CacheError extends Error {
  constructor(
    message: string,
    public readonly code: "CONNECTION_FAILED" | "OPERATION_FAILED",
  ) {
    super(message);
    this.name = "CacheError";
  }
}

export interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  delPattern(pattern: string): Promise<number>;
  increment(key: string, ttlSeconds?: number | undefined): Promise<number>;
  slidingWindowAdd(key: string, windowSeconds: number): Promise<number>;
  slidingWindowCount(key: string, windowSeconds: number): Promise<number>;
  isAvailable(): Promise<boolean>;
  close(): Promise<void>;
}

export function createCacheService(redisUrl: string, enabled: boolean = true): CacheService {
  let client: Redis | null = null;
  let connected = false;

  if (enabled) {
    try {
      client = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        retryStrategy(times) {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true,
      });

      client.on("connect", () => { connected = true; });
      client.on("close", () => { connected = false; });
      client.on("error", () => { connected = false; });

      client.connect().catch(() => { connected = false; });
    } catch {
      client = null;
      connected = false;
    }
  }

  return {
    async get<T>(key: string): Promise<T | null> {
      if (!client || !connected) return null;
      try {
        const raw = await client.get(key);
        if (raw === null) return null;
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },

    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      if (!client || !connected) return;
      try {
        await client.setex(key, ttlSeconds, JSON.stringify(value));
      } catch {
        // Graceful degradation — cache write failure is non-critical
      }
    },

    async del(key: string): Promise<void> {
      if (!client || !connected) return;
      try {
        await client.del(key);
      } catch {
        // Graceful degradation
      }
    },

    async delPattern(pattern: string): Promise<number> {
      if (!client || !connected) return 0;
      try {
        let deleted = 0;
        let cursor = "0";
        do {
          const [nextCursor, keys] = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
          cursor = nextCursor;
          if (keys.length > 0) {
            deleted += await client.del(...keys);
          }
        } while (cursor !== "0");
        return deleted;
      } catch {
        return 0;
      }
    },

    async increment(key: string, ttlSeconds?: number | undefined): Promise<number> {
      if (!client || !connected) return 0;
      try {
        const val = await client.incr(key);
        if (ttlSeconds !== undefined && val === 1) {
          await client.expire(key, ttlSeconds);
        }
        return val;
      } catch {
        return 0;
      }
    },

    async slidingWindowAdd(key: string, windowSeconds: number): Promise<number> {
      if (!client || !connected) return 0;
      try {
        const now = Date.now();
        const windowStart = now - windowSeconds * 1000;
        const pipeline = client.pipeline();
        pipeline.zremrangebyscore(key, 0, windowStart);
        pipeline.zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 8)}`);
        pipeline.zcard(key);
        pipeline.expire(key, windowSeconds);
        const results = await pipeline.exec();
        const countResult = results?.[2];
        return (countResult?.[1] as number) ?? 0;
      } catch {
        return 0;
      }
    },

    async slidingWindowCount(key: string, windowSeconds: number): Promise<number> {
      if (!client || !connected) return 0;
      try {
        const now = Date.now();
        const windowStart = now - windowSeconds * 1000;
        await client.zremrangebyscore(key, 0, windowStart);
        return await client.zcard(key);
      } catch {
        return 0;
      }
    },

    async isAvailable(): Promise<boolean> {
      if (!client || !connected) return false;
      try {
        const result = await client.ping();
        return result === "PONG";
      } catch {
        return false;
      }
    },

    async close(): Promise<void> {
      if (client) {
        await client.quit().catch(() => {});
        client = null;
        connected = false;
      }
    },
  };
}

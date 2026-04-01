import { describe, it, expect } from "vitest";
import { createBulkhead } from "./bulkhead.js";
import { ok, err } from "../core/result.js";

describe("Bulkhead", () => {
  it("allows execution within concurrency limit", async () => {
    const bh = createBulkhead({ name: "test", maxConcurrent: 2, maxQueue: 2 });
    const result = await bh.execute(async () => ok("done"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("done");
  });

  it("rejects when pool and queue are full", async () => {
    const bh = createBulkhead({ name: "test", maxConcurrent: 1, maxQueue: 0 });

    const slow = bh.execute(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return ok("first");
    });

    const rejected = await bh.execute(async () => ok("second"));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.message).toContain("rejected");

    await slow;
  });

  it("queues requests up to maxQueue", async () => {
    const bh = createBulkhead({ name: "test", maxConcurrent: 1, maxQueue: 2 });
    const results: string[] = [];

    const p1 = bh.execute(async () => {
      await new Promise((r) => setTimeout(r, 20));
      results.push("1");
      return ok("1");
    });

    const p2 = bh.execute(async () => {
      results.push("2");
      return ok("2");
    });

    await Promise.all([p1, p2]);
    expect(results).toEqual(["1", "2"]);
  });

  it("reports accurate stats", async () => {
    const bh = createBulkhead({ name: "test", maxConcurrent: 5, maxQueue: 10 });
    const stats = bh.getStats();
    expect(stats.name).toBe("test");
    expect(stats.maxConcurrent).toBe(5);
    expect(stats.activeCount).toBe(0);
    expect(stats.availableSlots).toBe(5);
  });

  it("propagates errors from the wrapped function", async () => {
    const bh = createBulkhead({ name: "test", maxConcurrent: 2, maxQueue: 2 });
    const result = await bh.execute(async () => err(new Error("inner failure")));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("inner failure");
  });
});

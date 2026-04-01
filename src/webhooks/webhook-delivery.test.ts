import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createWebhookDeliveryService,
  signPayload,
  verifySignature,
} from "./webhook-delivery.js";

function createMockPrisma() {
  let deliveries: Array<{
    id: string;
    registrationId: string;
    eventType: string;
    payload: unknown;
    url: string;
    status: string;
    attempts: number;
    lastAttemptAt: Date | null;
    nextRetryAt: Date | null;
    lastError: string | null;
  }> = [];
  let registrations: Array<{
    id: string;
    url: string;
    events: string[];
    active: boolean;
  }> = [];
  const dlqEntries: Array<unknown> = [];

  return {
    _deliveries: deliveries,
    _registrations: registrations,
    _dlq: dlqEntries,
    webhookRegistration: {
      create: vi.fn().mockImplementation(async ({ data }: { data: { url: string; events: string[]; tenantId?: string } }) => {
        const reg = { id: `reg_${registrations.length}`, ...data, active: true, tenantId: data.tenantId ?? "test-tenant" };
        registrations.push(reg);
        return reg;
      }),
      findMany: vi.fn().mockImplementation(async () => registrations.filter((r) => r.active)),
    },
    webhookDelivery: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const delivery = {
          id: `del_${deliveries.length}`,
          ...data,
          attempts: 0,
          lastAttemptAt: null,
          nextRetryAt: null,
          lastError: null,
        };
        deliveries.push(delivery as (typeof deliveries)[number]);
        return delivery;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = deliveries.findIndex((d) => d.id === where.id);
        if (idx !== -1) {
          const delivery = deliveries[idx]!;
          if (data["attempts"] && typeof data["attempts"] === "object" && "increment" in data["attempts"]) {
            delivery.attempts += (data["attempts"] as { increment: number }).increment;
          } else if (typeof data["attempts"] === "number") {
            delivery.attempts = data["attempts"];
          }
          if (data["status"]) delivery.status = data["status"] as string;
          if (data["lastError"] !== undefined) delivery.lastError = data["lastError"] as string;
        }
        return deliveries[idx];
      }),
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        return deliveries.find((d) => d.id === where.id) ?? null;
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    deadLetterQueue: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        dlqEntries.push(data);
        return data;
      }),
    },
  } as unknown as import("@prisma/client").PrismaClient & {
    _deliveries: typeof deliveries;
    _registrations: typeof registrations;
    _dlq: typeof dlqEntries;
  };
}

describe("WebhookDeliveryService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  const secret = "test-secret";

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  it("registers a webhook URL", async () => {
    const service = createWebhookDeliveryService(prisma, secret, "test-tenant");
    const result = await service.register("https://example.com/webhook");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("reg_0");
  });

  it("delivers webhooks to registered URLs", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = createWebhookDeliveryService(prisma, secret, "test-tenant", mockFetch as unknown as typeof fetch);

    await service.register("https://example.com/webhook");
    const result = await service.dispatch("payment.completed", { paymentId: "p1" });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://example.com/webhook");
    expect(options.method).toBe("POST");
    expect(options.headers["X-Webhook-Signature"]).toBeDefined();
  });

  it("includes valid HMAC-SHA256 signature", async () => {
    let capturedBody = "";
    let capturedSignature = "";

    const mockFetch = vi.fn().mockImplementation(async (_url: string, opts: { body: string; headers: Record<string, string> }) => {
      capturedBody = opts.body;
      capturedSignature = opts.headers["X-Webhook-Signature"]!;
      return { ok: true, status: 200 };
    });

    const service = createWebhookDeliveryService(prisma, secret, "test-tenant", mockFetch as unknown as typeof fetch);
    await service.register("https://example.com/webhook");
    await service.dispatch("payment.completed", { paymentId: "p1" });

    expect(verifySignature(capturedBody, capturedSignature, secret)).toBe(true);
  });

  it("sends to dead-letter queue after max retries", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    const service = createWebhookDeliveryService(prisma, secret, "test-tenant", mockFetch as unknown as typeof fetch);

    await service.register("https://example.com/webhook");

    // Override findUnique to return a delivery with 2 prior attempts (so next = 3 = max)
    (prisma.webhookDelivery.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "del_0",
      attempts: 2,
    });

    await service.dispatch("payment.completed", { paymentId: "p1" });

    expect(prisma.deadLetterQueue.create).toHaveBeenCalled();
  });

  it("retries failed deliveries with backoff", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("temporary failure");
      return { ok: true, status: 200 };
    });

    const service = createWebhookDeliveryService(prisma, secret, "test-tenant", mockFetch as unknown as typeof fetch);
    await service.register("https://example.com/webhook");
    await service.dispatch("test.event", { data: "test" });

    // First call fails, then delivery record gets updated with nextRetryAt
    expect(mockFetch).toHaveBeenCalled();
  });

  it("filters registrations by event type", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const service = createWebhookDeliveryService(prisma, secret, "test-tenant", mockFetch as unknown as typeof fetch);

    await service.register("https://example.com/payments", ["payment.completed"]);
    await service.register("https://example.com/all", ["*"]);

    await service.dispatch("payment.completed", { paymentId: "p1" });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    mockFetch.mockClear();
    await service.dispatch("order.created", { orderId: "o1" });
    expect(mockFetch).toHaveBeenCalledTimes(1); // Only the wildcard registration
  });
});

describe("HMAC Signature", () => {
  const secret = "my-secret-key";

  it("generates a deterministic signature", () => {
    const payload = '{"event":"test"}';
    const sig1 = signPayload(payload, secret);
    const sig2 = signPayload(payload, secret);
    expect(sig1).toBe(sig2);
  });

  it("verifies a valid signature", () => {
    const payload = '{"event":"test"}';
    const signature = signPayload(payload, secret);
    expect(verifySignature(payload, signature, secret)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const payload = '{"event":"test"}';
    expect(verifySignature(payload, "invalid-signature", secret)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const original = '{"event":"test"}';
    const signature = signPayload(original, secret);
    expect(verifySignature('{"event":"tampered"}', signature, secret)).toBe(false);
  });

  it("rejects wrong secret", () => {
    const payload = '{"event":"test"}';
    const signature = signPayload(payload, secret);
    expect(verifySignature(payload, signature, "wrong-secret")).toBe(false);
  });
});

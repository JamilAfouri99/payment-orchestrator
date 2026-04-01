import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApiKeyService } from "./api-key-service.js";

type DbApiKey = {
  id: string;
  tenantId: string;
  merchantAccountId: string | null;
  keyPrefix: string;
  keyHash: string;
  environment: string;
  permissions: string[];
  status: string;
  name: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdBy: string | null;
  revokedBy: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function createMockPrisma() {
  const store = new Map<string, DbApiKey>();

  return {
    _store: store,
    apiKey: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Partial<DbApiKey> }) => {
        const row: DbApiKey = {
          id: data.id ?? "key_1",
          tenantId: data.tenantId ?? "",
          merchantAccountId: data.merchantAccountId ?? null,
          keyPrefix: data.keyPrefix ?? "",
          keyHash: data.keyHash ?? "",
          environment: data.environment ?? "sandbox",
          permissions: (data.permissions ?? []) as string[],
          status: "active",
          name: data.name ?? "",
          expiresAt: data.expiresAt ?? null,
          lastUsedAt: null,
          createdBy: data.createdBy ?? null,
          revokedBy: null,
          revokedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.set(row.id, row);
        return row;
      }),
      findMany: vi.fn().mockImplementation(
        async ({
          where,
        }: {
          where?: {
            tenantId?: string;
            keyPrefix?: { startsWith: string };
            status?: string;
          };
        } = {}) => {
          let results = [...store.values()];
          if (where?.tenantId !== undefined) {
            results = results.filter((k) => k.tenantId === where.tenantId);
          }
          if (where?.keyPrefix?.startsWith !== undefined) {
            results = results.filter((k) => k.keyPrefix.startsWith(where.keyPrefix!.startsWith));
          }
          if (where?.status !== undefined) {
            results = results.filter((k) => k.status === where.status);
          }
          return results;
        },
      ),
      update: vi.fn().mockImplementation(
        async ({ where, data }: { where: { id: string }; data: Partial<DbApiKey> }) => {
          const existing = store.get(where.id);
          if (existing === undefined) throw new Error("Record not found");
          const updated: DbApiKey = { ...existing, ...data, updatedAt: new Date() };
          store.set(where.id, updated);
          return updated;
        },
      ),
    },
  } as unknown as import("@prisma/client").PrismaClient & { _store: Map<string, DbApiKey> };
}

describe("ApiKeyService — generate", () => {
  it("generates a key with pk_test_ prefix for sandbox environment", async () => {
    const prisma = createMockPrisma();
    const service = createApiKeyService(prisma);

    const result = await service.generate("tenant_1", { environment: "sandbox", name: "Test key" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fullKey).toMatch(/^pk_test_/);
  });

  it("generates a key with pk_live_ prefix for production environment", async () => {
    const prisma = createMockPrisma();
    const service = createApiKeyService(prisma);

    const result = await service.generate("tenant_1", { environment: "production", name: "Live key" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fullKey).toMatch(/^pk_live_/);
  });

  it("generates a key with sufficient length (greater than 40 chars)", async () => {
    const prisma = createMockPrisma();
    const service = createApiKeyService(prisma);

    const result = await service.generate("tenant_1", { environment: "sandbox" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fullKey.length).toBeGreaterThan(40);
  });

  it("stores a hash that is not the raw key", async () => {
    const prisma = createMockPrisma();
    const service = createApiKeyService(prisma);

    const result = await service.generate("tenant_1", { environment: "sandbox" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = [...(prisma as unknown as { _store: Map<string, DbApiKey> })._store.values()][0]!;
    expect(stored.keyHash).not.toBe(result.value.fullKey);
    expect(stored.keyHash).toMatch(/^\$2[ab]\$/);
  });

  it("generates unique keys on repeated calls", async () => {
    const prisma = createMockPrisma();
    const service = createApiKeyService(prisma);

    const r1 = await service.generate("tenant_1", { environment: "sandbox" });
    const r2 = await service.generate("tenant_1", { environment: "sandbox" });

    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.value.fullKey).not.toBe(r2.value.fullKey);
  });
});

describe("ApiKeyService — validate", () => {
  it("validates a correct key and returns tenant info", async () => {
    const prisma = createMockPrisma();
    const service = createApiKeyService(prisma);

    const genResult = await service.generate("tenant_abc", {
      environment: "sandbox",
      merchantAccountId: "ma_1",
    });
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    const result = await service.validate(genResult.value.fullKey);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tenantId).toBe("tenant_abc");
    expect(result.value.merchantAccountId).toBe("ma_1");
    expect(result.value.environment).toBe("sandbox");
  });

  it("returns INVALID_KEY error for an unknown key", async () => {
    const prisma = createMockPrisma();
    const service = createApiKeyService(prisma);

    const result = await service.validate("pk_test_completely_fake_key_that_does_not_exist");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_KEY");
  });

  it("returns INVALID_KEY for a key that is too short", async () => {
    const prisma = createMockPrisma();
    const service = createApiKeyService(prisma);

    const result = await service.validate("short");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_KEY");
  });

  it("returns KEY_EXPIRED for an expired key", async () => {
    const prisma = createMockPrisma();
    const service = createApiKeyService(prisma);

    const pastDate = new Date(Date.now() - 1000);
    const genResult = await service.generate("tenant_1", {
      environment: "sandbox",
      expiresAt: pastDate,
    });
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    const result = await service.validate(genResult.value.fullKey);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("KEY_EXPIRED");
  });
});

describe("ApiKeyService — revoke", () => {
  it("revokes a key and sets status to revoked with timestamp", async () => {
    const prisma = createMockPrisma();
    const service = createApiKeyService(prisma);

    const genResult = await service.generate("tenant_1", { environment: "sandbox" });
    expect(genResult.ok).toBe(true);
    if (!genResult.ok) return;

    const keyId = genResult.value.record.id;
    const result = await service.revoke(keyId, "user_admin");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = (prisma as unknown as { _store: Map<string, DbApiKey> })._store.get(keyId)!;
    expect(stored.status).toBe("revoked");
    expect(stored.revokedAt).toBeInstanceOf(Date);
    expect(stored.revokedBy).toBe("user_admin");
  });

  it("returns error when revoking a non-existent key ID", async () => {
    const prisma = createMockPrisma();
    const service = createApiKeyService(prisma);

    const result = await service.revoke("ghost-key-id", "user_admin");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_KEY");
  });
});

describe("ApiKeyService — listByTenant", () => {
  it("returns all keys for the specified tenant", async () => {
    const prisma = createMockPrisma();
    const service = createApiKeyService(prisma);

    await service.generate("tenant_A", { environment: "sandbox" });
    await service.generate("tenant_A", { environment: "sandbox" });
    await service.generate("tenant_B", { environment: "sandbox" });

    const result = await service.listByTenant("tenant_A");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(2);
    expect(result.value.every((k) => k.tenantId === "tenant_A")).toBe(true);
  });

  it("never returns the key hash in listed records", async () => {
    const prisma = createMockPrisma();
    const service = createApiKeyService(prisma);

    await service.generate("tenant_A", { environment: "sandbox" });

    const result = await service.listByTenant("tenant_A");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const key of result.value) {
      expect(Object.keys(key)).not.toContain("keyHash");
    }
  });

  it("returns an empty array when the tenant has no keys", async () => {
    const prisma = createMockPrisma();
    const service = createApiKeyService(prisma);

    const result = await service.listByTenant("tenant_nobody");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTenantService, type TenantRecord, type MerchantAccountRecord } from "./tenant-service.js";

type DbTenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  defaultCurrency: string;
  timezone: string;
  webhookSecret: string;
  trialExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type DbMerchantAccount = {
  id: string;
  tenantId: string;
  name: string;
  environment: string;
  status: string;
  mcc: string | null;
  businessType: string | null;
  riskTier: string;
  settlementCurrency: string;
  payoutSchedule: string;
  createdAt: Date;
  updatedAt: Date;
};

function makeTenantRow(overrides: Partial<DbTenant> = {}): DbTenant {
  return {
    id: "tenant_1",
    name: "Acme Corp",
    slug: "acme-corp",
    status: "onboarding",
    plan: "free",
    defaultCurrency: "USD",
    timezone: "UTC",
    webhookSecret: "secret_abc",
    trialExpiresAt: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

function makeMerchantRow(overrides: Partial<DbMerchantAccount> = {}): DbMerchantAccount {
  return {
    id: "ma_1",
    tenantId: "tenant_1",
    name: "Acme Corp (Sandbox)",
    environment: "sandbox",
    status: "active",
    mcc: null,
    businessType: null,
    riskTier: "standard",
    settlementCurrency: "USD",
    payoutSchedule: "daily",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

function createMockPrisma() {
  const tenants = new Map<string, DbTenant>();
  const tenantsBySlug = new Map<string, DbTenant>();
  const merchantAccounts = new Map<string, DbMerchantAccount>();

  return {
    _tenants: tenants,
    _merchantAccounts: merchantAccounts,
    tenant: {
      findUnique: vi.fn().mockImplementation(
        async ({ where }: { where: { id?: string; slug?: string } }) => {
          if (where.id !== undefined) return tenants.get(where.id) ?? null;
          if (where.slug !== undefined) return tenantsBySlug.get(where.slug) ?? null;
          return null;
        },
      ),
      create: vi.fn().mockImplementation(
        async ({ data }: { data: Omit<DbTenant, "status" | "plan" | "defaultCurrency" | "timezone" | "createdAt" | "updatedAt"> & Partial<DbTenant> }) => {
          const row: DbTenant = {
            id: data.id,
            name: data.name,
            slug: data.slug,
            status: data.status ?? "onboarding",
            plan: data.plan ?? "free",
            defaultCurrency: data.defaultCurrency ?? "USD",
            timezone: data.timezone ?? "UTC",
            webhookSecret: data.webhookSecret ?? "",
            trialExpiresAt: (data as DbTenant).trialExpiresAt ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          tenants.set(row.id, row);
          tenantsBySlug.set(row.slug, row);
          return row;
        },
      ),
      update: vi.fn().mockImplementation(
        async ({ where, data }: { where: { id: string }; data: Partial<DbTenant> }) => {
          const existing = tenants.get(where.id);
          if (existing === undefined) {
            throw new Error("Record to update not found");
          }
          const updated: DbTenant = { ...existing, ...data, updatedAt: new Date() };
          tenants.set(where.id, updated);
          tenantsBySlug.set(updated.slug, updated);
          return updated;
        },
      ),
    },
    merchantAccount: {
      create: vi.fn().mockImplementation(
        async ({ data }: { data: Partial<DbMerchantAccount> }) => {
          const row: DbMerchantAccount = {
            id: data.id ?? "ma_new",
            tenantId: data.tenantId ?? "",
            name: data.name ?? "",
            environment: data.environment ?? "sandbox",
            status: data.status ?? "active",
            mcc: data.mcc ?? null,
            businessType: data.businessType ?? null,
            riskTier: data.riskTier ?? "standard",
            settlementCurrency: data.settlementCurrency ?? "USD",
            payoutSchedule: data.payoutSchedule ?? "daily",
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          merchantAccounts.set(row.id, row);
          return row;
        },
      ),
      findMany: vi.fn().mockImplementation(
        async ({ where }: { where: { tenantId: string } }) =>
          [...merchantAccounts.values()].filter((m) => m.tenantId === where.tenantId),
      ),
      findUnique: vi.fn().mockImplementation(
        async ({ where }: { where: { id: string } }) =>
          merchantAccounts.get(where.id) ?? null,
      ),
    },
    $transaction: vi.fn().mockImplementation(async (ops: Promise<unknown>[]) =>
      Promise.all(ops),
    ),
  } as unknown as import("@prisma/client").PrismaClient & {
    _tenants: Map<string, DbTenant>;
    _merchantAccounts: Map<string, DbMerchantAccount>;
  };
}

describe("TenantService — createTenant", () => {
  it("creates a tenant and auto-generates a non-empty webhook secret", async () => {
    const prisma = createMockPrisma();
    const service = createTenantService(prisma);

    const result = await service.createTenant("Acme Corp", "acme-corp");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tenant.webhookSecret).toBeTruthy();
    expect(result.value.tenant.webhookSecret.length).toBeGreaterThan(0);
    expect(result.value.tenant.webhookSecret).not.toBe("secret_abc");
  });

  it("returns SLUG_TAKEN error when the slug already exists", async () => {
    const prisma = createMockPrisma();
    const service = createTenantService(prisma);

    await service.createTenant("First Corp", "shared-slug");
    const result = await service.createTenant("Second Corp", "shared-slug");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SLUG_TAKEN");
  });

  it("creates a default sandbox merchant account alongside the tenant", async () => {
    const prisma = createMockPrisma();
    const service = createTenantService(prisma);

    const result = await service.createTenant("Acme Corp", "acme-corp");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.merchantAccount.environment).toBe("sandbox");
    expect(result.value.merchantAccount.tenantId).toBe(result.value.tenant.id);
  });

  it("merchant account name includes the tenant name", async () => {
    const prisma = createMockPrisma();
    const service = createTenantService(prisma);

    const result = await service.createTenant("Globex Ltd", "globex-ltd");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.merchantAccount.name).toContain("Globex Ltd");
  });
});

describe("TenantService — getTenant", () => {
  it("returns the tenant by ID", async () => {
    const prisma = createMockPrisma();
    const service = createTenantService(prisma);

    const createResult = await service.createTenant("Acme Corp", "acme-corp");
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await service.getTenant(createResult.value.tenant.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slug).toBe("acme-corp");
    expect(result.value.name).toBe("Acme Corp");
  });

  it("returns NOT_FOUND for an unknown tenant ID", async () => {
    const prisma = createMockPrisma();
    const service = createTenantService(prisma);

    const result = await service.getTenant("does-not-exist");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("TenantService — getTenantBySlug", () => {
  it("returns the tenant by slug", async () => {
    const prisma = createMockPrisma();
    const service = createTenantService(prisma);

    await service.createTenant("Acme Corp", "acme-corp");
    const result = await service.getTenantBySlug("acme-corp");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Acme Corp");
  });

  it("returns NOT_FOUND for an unknown slug", async () => {
    const prisma = createMockPrisma();
    const service = createTenantService(prisma);

    const result = await service.getTenantBySlug("ghost-slug");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("TenantService — updateTenant", () => {
  it("updates the specified fields and returns the updated tenant", async () => {
    const prisma = createMockPrisma();
    const service = createTenantService(prisma);

    const createResult = await service.createTenant("Old Name", "old-slug");
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await service.updateTenant(createResult.value.tenant.id, {
      name: "New Name",
      plan: "starter",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("New Name");
    expect(result.value.plan).toBe("starter");
  });

  it("returns NOT_FOUND when updating a non-existent tenant", async () => {
    const prisma = createMockPrisma();
    const service = createTenantService(prisma);

    const result = await service.updateTenant("ghost-id", { name: "Whatever" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("TenantService — createMerchantAccount", () => {
  it("creates an additional merchant account for the tenant", async () => {
    const prisma = createMockPrisma();
    const service = createTenantService(prisma);

    const createResult = await service.createTenant("Acme Corp", "acme-corp");
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await service.createMerchantAccount(
      createResult.value.tenant.id,
      "Acme Production",
      "production",
      { settlementCurrency: "EUR" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Acme Production");
    expect(result.value.environment).toBe("production");
    expect(result.value.settlementCurrency).toBe("EUR");
    expect(result.value.tenantId).toBe(createResult.value.tenant.id);
  });
});

describe("TenantService — getMerchantAccounts", () => {
  it("lists all merchant accounts for a tenant", async () => {
    const prisma = createMockPrisma();
    const service = createTenantService(prisma);

    const createResult = await service.createTenant("Acme Corp", "acme-corp");
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    await service.createMerchantAccount(
      createResult.value.tenant.id,
      "Acme Production",
      "production",
    );

    const result = await service.getMerchantAccounts(createResult.value.tenant.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The createTenant call already created the sandbox account
    expect(result.value.length).toBe(2);
    expect(result.value.every((m) => m.tenantId === createResult.value.tenant.id)).toBe(true);
  });

  it("does not return merchant accounts belonging to another tenant", async () => {
    const prisma = createMockPrisma();
    const service = createTenantService(prisma);

    await service.createTenant("Acme Corp", "acme-corp");
    await service.createTenant("Other Corp", "other-corp");

    const acmeResult = await service.getTenantBySlug("acme-corp");
    expect(acmeResult.ok).toBe(true);
    if (!acmeResult.ok) return;

    const result = await service.getMerchantAccounts(acmeResult.value.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.every((m) => m.tenantId === acmeResult.value.id)).toBe(true);
  });
});

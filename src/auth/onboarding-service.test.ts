import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOnboardingService, type KybDetails } from "./onboarding-service.js";

type DbKybApplication = {
  id: string;
  tenantId: string;
  businessName: string;
  businessType: string;
  country: string;
  status: string;
  registrationNumber: string | null;
  taxId: string | null;
  website: string | null;
  address: string | null;
  phone: string | null;
  representativeName: string | null;
  representativeDob: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type DbFraudRule = {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  ruleType: string;
  config: object;
  weight: number;
  enabled: boolean;
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

function makeLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function makeKybDetails(overrides: Partial<KybDetails> = {}): KybDetails {
  return {
    businessName: "Acme Corp",
    businessType: "llc",
    country: "US",
    ...overrides,
  };
}

function makeTenantRecord(tenantId: string, status = "onboarding") {
  return {
    id: tenantId,
    name: "Acme Corp",
    slug: "acme-corp",
    status,
    plan: "free",
    defaultCurrency: "USD",
    timezone: "UTC",
    webhookSecret: "wh_secret",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeMerchantAccountRecord(tenantId: string, env = "production") {
  return {
    id: `ma_${env}`,
    tenantId,
    name: `Acme Corp (${env})`,
    environment: env,
    status: "active",
    riskTier: "standard",
    settlementCurrency: "USD",
    payoutSchedule: "daily",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockPrisma(tenantId = "tenant_1") {
  const kybApplications = new Map<string, DbKybApplication>();
  const fraudRules = new Map<string, DbFraudRule>();
  const merchantAccounts = new Map<string, DbMerchantAccount>();

  const sandboxAccount: DbMerchantAccount = {
    id: "ma_sandbox",
    tenantId,
    name: "Acme Corp (Sandbox)",
    environment: "sandbox",
    status: "active",
    mcc: null,
    businessType: null,
    riskTier: "standard",
    settlementCurrency: "USD",
    payoutSchedule: "daily",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  merchantAccounts.set("ma_sandbox", sandboxAccount);

  return {
    _kybApplications: kybApplications,
    _fraudRules: fraudRules,
    _merchantAccounts: merchantAccounts,
    kybApplication: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Partial<DbKybApplication> }) => {
        const row: DbKybApplication = {
          id: data.id ?? "kyb_new",
          tenantId: data.tenantId ?? tenantId,
          businessName: data.businessName ?? "",
          businessType: data.businessType ?? "",
          country: data.country ?? "",
          status: data.status ?? "pending",
          registrationNumber: data.registrationNumber ?? null,
          taxId: data.taxId ?? null,
          website: data.website ?? null,
          address: data.address ?? null,
          phone: data.phone ?? null,
          representativeName: data.representativeName ?? null,
          representativeDob: data.representativeDob ?? null,
          reviewedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        kybApplications.set(row.id, row);
        return row;
      }),
      findFirst: vi.fn().mockImplementation(
        async ({ where }: { where: { tenantId: string }; orderBy?: unknown }) => {
          const matches = [...kybApplications.values()].filter(
            (k) => k.tenantId === where.tenantId,
          );
          if (matches.length === 0) return null;
          return matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
        },
      ),
      update: vi.fn().mockImplementation(
        async ({ where, data }: { where: { id: string }; data: Partial<DbKybApplication> }) => {
          const existing = kybApplications.get(where.id);
          if (existing === undefined) throw new Error("Not found");
          const updated: DbKybApplication = { ...existing, ...data };
          kybApplications.set(where.id, updated);
          return updated;
        },
      ),
    },
    fraudRule: {
      findFirst: vi.fn().mockImplementation(
        async ({ where }: { where: { tenantId: string; ruleType: string } }) => {
          for (const r of fraudRules.values()) {
            if (r.tenantId === where.tenantId && r.ruleType === where.ruleType) return r;
          }
          return null;
        },
      ),
      create: vi.fn().mockImplementation(async ({ data }: { data: Partial<DbFraudRule> }) => {
        const row: DbFraudRule = {
          id: data.id ?? `rule_${Math.random()}`,
          tenantId: data.tenantId ?? tenantId,
          name: data.name ?? "",
          description: data.description ?? "",
          ruleType: data.ruleType ?? "",
          config: (data.config ?? {}) as object,
          weight: data.weight ?? 0,
          enabled: data.enabled ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        fraudRules.set(row.id, row);
        return row;
      }),
      update: vi.fn().mockImplementation(
        async ({ where, data }: { where: { id: string }; data: Partial<DbFraudRule> }) => {
          const existing = fraudRules.get(where.id);
          if (existing === undefined) throw new Error("Not found");
          const updated: DbFraudRule = { ...existing, ...data };
          fraudRules.set(where.id, updated);
          return updated;
        },
      ),
    },
    merchantAccount: {
      findMany: vi.fn().mockImplementation(
        async ({ where }: { where: { tenantId: string; environment?: string } }) => {
          return [...merchantAccounts.values()].filter((m) => {
            if (m.tenantId !== where.tenantId) return false;
            if (where.environment !== undefined && m.environment !== where.environment) return false;
            return true;
          });
        },
      ),
      update: vi.fn().mockImplementation(
        async ({ where, data }: { where: { id: string }; data: Partial<DbMerchantAccount> }) => {
          const existing = merchantAccounts.get(where.id);
          if (existing === undefined) throw new Error("Not found");
          const updated: DbMerchantAccount = { ...existing, ...data };
          merchantAccounts.set(where.id, updated);
          return updated;
        },
      ),
    },
  } as unknown as import("@prisma/client").PrismaClient & {
    _kybApplications: Map<string, DbKybApplication>;
    _fraudRules: Map<string, DbFraudRule>;
    _merchantAccounts: Map<string, DbMerchantAccount>;
  };
}

function makeMockTenantService(tenantId = "tenant_1", status = "onboarding") {
  const tenant = makeTenantRecord(tenantId, status);
  const prodAccount = makeMerchantAccountRecord(tenantId, "production");

  return {
    createTenant: vi.fn(),
    getTenant: vi.fn().mockResolvedValue({ ok: true, value: tenant }),
    getTenantBySlug: vi.fn(),
    updateTenant: vi.fn().mockResolvedValue({ ok: true, value: { ...tenant, status: "active" } }),
    createMerchantAccount: vi.fn().mockResolvedValue({ ok: true, value: prodAccount }),
    getMerchantAccounts: vi.fn(),
    getMerchantAccount: vi.fn(),
  };
}

function makeMockSessionService() {
  return {
    register: vi.fn(),
    login: vi.fn(),
    verifyToken: vi.fn(),
    getUser: vi.fn(),
  };
}

function makeMockApiKeyService() {
  return {
    generate: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        fullKey: "pk_live_abc123def456ghi789jkl012mno345pqr678stu901",
        record: {
          id: "key_live",
          tenantId: "tenant_1",
          keyPrefix: "pk_live_ab",
          environment: "production",
          permissions: ["payments:read", "payments:write"],
          status: "active",
          name: "Default production key",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    }),
    validate: vi.fn(),
    revoke: vi.fn(),
    listByTenant: vi.fn(),
  };
}

describe("OnboardingService — submitKyb", () => {
  it("creates a KYB application with pending status", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const tenantService = makeMockTenantService();
    const sessionService = makeMockSessionService();
    const apiKeyService = makeMockApiKeyService();

    const service = createOnboardingService({
      prisma,
      tenantService: tenantService as never,
      sessionService: sessionService as never,
      apiKeyService: apiKeyService as never,
      logger: logger as never,
    });

    const result = await service.submitKyb("tenant_1", makeKybDetails());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("pending");
    expect(result.value.tenantId).toBe("tenant_1");
    expect(result.value.businessName).toBe("Acme Corp");
  });

  it("includes optional fields in the application when provided", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createOnboardingService({
      prisma,
      tenantService: makeMockTenantService() as never,
      sessionService: makeMockSessionService() as never,
      apiKeyService: makeMockApiKeyService() as never,
      logger: logger as never,
    });

    const result = await service.submitKyb(
      "tenant_1",
      makeKybDetails({
        registrationNumber: "REG123",
        website: "https://acme.example.com",
        representativeName: "Jane Doe",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registrationNumber).toBe("REG123");
    expect(result.value.website).toBe("https://acme.example.com");
    expect(result.value.representativeName).toBe("Jane Doe");
  });
});

describe("OnboardingService — getKybStatus", () => {
  it("returns the most recent KYB application for the tenant", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createOnboardingService({
      prisma,
      tenantService: makeMockTenantService() as never,
      sessionService: makeMockSessionService() as never,
      apiKeyService: makeMockApiKeyService() as never,
      logger: logger as never,
    });

    await service.submitKyb("tenant_1", makeKybDetails());

    const result = await service.getKybStatus("tenant_1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull();
    expect(result.value!.status).toBe("pending");
    expect(result.value!.tenantId).toBe("tenant_1");
  });

  it("returns null when no KYB application exists for the tenant", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createOnboardingService({
      prisma,
      tenantService: makeMockTenantService() as never,
      sessionService: makeMockSessionService() as never,
      apiKeyService: makeMockApiKeyService() as never,
      logger: logger as never,
    });

    const result = await service.getKybStatus("tenant_nobody");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });
});

describe("OnboardingService — configure fraud sensitivity", () => {
  it("creates fewer (lower-weight) rules with 'low' sensitivity", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createOnboardingService({
      prisma,
      tenantService: makeMockTenantService() as never,
      sessionService: makeMockSessionService() as never,
      apiKeyService: makeMockApiKeyService() as never,
      logger: logger as never,
    });

    await service.configure("tenant_1", { fraudSensitivity: "low" });

    const rules = [...(prisma as unknown as { _fraudRules: Map<string, DbFraudRule> })._fraudRules.values()];
    const enabledRules = rules.filter((r) => r.enabled);
    expect(enabledRules.length).toBeLessThan(rules.length);
  });

  it("creates rules with higher weights with 'high' sensitivity", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createOnboardingService({
      prisma,
      tenantService: makeMockTenantService() as never,
      sessionService: makeMockSessionService() as never,
      apiKeyService: makeMockApiKeyService() as never,
      logger: logger as never,
    });

    await service.configure("tenant_1", { fraudSensitivity: "high" });

    const rules = [...(prisma as unknown as { _fraudRules: Map<string, DbFraudRule> })._fraudRules.values()];
    const enabledRules = rules.filter((r) => r.enabled);
    const avgWeight = enabledRules.reduce((sum, r) => sum + r.weight, 0) / (enabledRules.length || 1);
    expect(avgWeight).toBeGreaterThan(30);
  });
});

describe("OnboardingService — goLive", () => {
  it("returns KYB_NOT_APPROVED when no KYB application exists", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createOnboardingService({
      prisma,
      tenantService: makeMockTenantService() as never,
      sessionService: makeMockSessionService() as never,
      apiKeyService: makeMockApiKeyService() as never,
      logger: logger as never,
    });

    const result = await service.goLive("tenant_1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("KYB_NOT_FOUND");
  });

  it("returns KYB_NOT_APPROVED when KYB status is still pending", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createOnboardingService({
      prisma,
      tenantService: makeMockTenantService() as never,
      sessionService: makeMockSessionService() as never,
      apiKeyService: makeMockApiKeyService() as never,
      logger: logger as never,
    });

    await service.submitKyb("tenant_1", makeKybDetails());

    const result = await service.goLive("tenant_1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("KYB_NOT_APPROVED");
  });

  it("generates a production key and merchant account when KYB is approved", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();

    // Seed an approved KYB application directly into the mock store
    const approvedKyb: DbKybApplication = {
      id: "kyb_approved",
      tenantId: "tenant_1",
      businessName: "Acme Corp",
      businessType: "llc",
      country: "US",
      status: "approved",
      registrationNumber: null,
      taxId: null,
      website: null,
      address: null,
      phone: null,
      representativeName: null,
      representativeDob: null,
      reviewedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (prisma as unknown as { _kybApplications: Map<string, DbKybApplication> })._kybApplications.set(
      "kyb_approved",
      approvedKyb,
    );

    const tenantService = makeMockTenantService("tenant_1", "onboarding");
    const apiKeyService = makeMockApiKeyService();
    const service = createOnboardingService({
      prisma,
      tenantService: tenantService as never,
      sessionService: makeMockSessionService() as never,
      apiKeyService: apiKeyService as never,
      logger: logger as never,
    });

    const result = await service.goLive("tenant_1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.productionApiKey.fullKey).toMatch(/^pk_live_/);
    expect(result.value.productionMerchantAccountId).toBeTruthy();
  });
});

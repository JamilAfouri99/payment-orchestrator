import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSessionService, type UserRecord } from "./session-service.js";
import jwt from "jsonwebtoken";

const TEST_SECRET = "test-jwt-secret-for-unit-tests";

type DbUser = {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  name: string;
  role: string;
  status: string;
  emailVerified: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type DbTeamMember = {
  id: string;
  tenantId: string;
  userId: string;
  role: string;
  status: string;
  invitedBy: string | null;
  invitedAt: Date | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};


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

function createMockPrisma(tenantId = "tenant_test") {
  const users = new Map<string, DbUser>();
  const usersByEmail = new Map<string, DbUser>();
  const teamMembers = new Map<string, DbTeamMember>();
  const tenants = new Map<string, DbTenant>();
  const tenantsBySlug = new Map<string, DbTenant>();
  const merchantAccounts = new Map<string, DbMerchantAccount>();
  const apiKeys = new Map<string, DbApiKey>();

  return {
    _users: users,
    user: {
      findUnique: vi.fn().mockImplementation(
        async ({ where }: { where: { id?: string; email?: string } }) => {
          if (where.id !== undefined) return users.get(where.id) ?? null;
          if (where.email !== undefined) return usersByEmail.get(where.email) ?? null;
          return null;
        },
      ),
      create: vi.fn().mockImplementation(async ({ data }: { data: Partial<DbUser> }) => {
        const row: DbUser = {
          id: data.id ?? "user_1",
          tenantId: data.tenantId ?? tenantId,
          email: data.email ?? "",
          passwordHash: data.passwordHash ?? "",
          name: data.name ?? "",
          role: data.role ?? "owner",
          status: data.status ?? "active",
          emailVerified: data.emailVerified ?? false,
          lastLoginAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        users.set(row.id, row);
        usersByEmail.set(row.email, row);
        return row;
      }),
      update: vi.fn().mockImplementation(
        async ({ where, data }: { where: { id: string }; data: Partial<DbUser> }) => {
          const existing = users.get(where.id);
          if (existing === undefined) throw new Error("Not found");
          const updated: DbUser = { ...existing, ...data };
          users.set(where.id, updated);
          usersByEmail.set(updated.email, updated);
          return updated;
        },
      ),
    },
    teamMember: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Partial<DbTeamMember> }) => {
        const row: DbTeamMember = {
          id: data.id ?? "member_1",
          tenantId: data.tenantId ?? tenantId,
          userId: data.userId ?? "",
          role: data.role ?? "owner",
          status: data.status ?? "active",
          invitedBy: null,
          invitedAt: null,
          acceptedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        teamMembers.set(row.id, row);
        return row;
      }),
    },
    tenant: {
      findUnique: vi.fn().mockImplementation(
        async ({ where }: { where: { id?: string; slug?: string } }) => {
          if (where.id !== undefined) return tenants.get(where.id) ?? null;
          if (where.slug !== undefined) return tenantsBySlug.get(where.slug) ?? null;
          return null;
        },
      ),
      create: vi.fn().mockImplementation(async ({ data }: { data: Partial<DbTenant> }) => {
        const newTenantId = data.id ?? `tenant_${Math.random().toString(36).slice(2)}`;
        const row: DbTenant = {
          id: newTenantId,
          name: data.name ?? "",
          slug: data.slug ?? "",
          status: data.status ?? "onboarding",
          plan: data.plan ?? "free",
          defaultCurrency: data.defaultCurrency ?? "USD",
          timezone: data.timezone ?? "UTC",
          webhookSecret: data.webhookSecret ?? "",
          trialExpiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        tenants.set(row.id, row);
        tenantsBySlug.set(row.slug, row);
        return row;
      }),
    },
    merchantAccount: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Partial<DbMerchantAccount> }) => {
        const row: DbMerchantAccount = {
          id: data.id ?? `ma_${Math.random().toString(36).slice(2)}`,
          tenantId: data.tenantId ?? "",
          name: data.name ?? "",
          environment: data.environment ?? "sandbox",
          status: "active",
          mcc: null,
          businessType: null,
          riskTier: "standard",
          settlementCurrency: "USD",
          payoutSchedule: "daily",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        merchantAccounts.set(row.id, row);
        return row;
      }),
    },
    apiKey: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Partial<DbApiKey> }) => {
        const row: DbApiKey = {
          id: data.id ?? `key_${Math.random().toString(36).slice(2)}`,
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
        apiKeys.set(row.id, row);
        return row;
      }),
    },
    $transaction: vi.fn().mockImplementation(async (ops: Promise<unknown>[]) =>
      Promise.all(ops),
    ),
  } as unknown as import("@prisma/client").PrismaClient & { _users: Map<string, DbUser> };
}

describe("SessionService — register", () => {
  it("creates a user, tenant, and returns an API key on success", async () => {
    const prisma = createMockPrisma();
    const service = createSessionService(prisma, TEST_SECRET);

    const result = await service.register(
      "alice@example.com",
      "super-secret-pw",
      "Alice",
      "Acme Corp",
      "acme-corp",
      "US",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.user.email).toBe("alice@example.com");
    expect(result.value.token).toBeTruthy();
    expect(result.value.apiKey.fullKey).toMatch(/^pk_test_/);
  });

  it("returns EMAIL_TAKEN error when the email is already registered", async () => {
    const prisma = createMockPrisma();
    const service = createSessionService(prisma, TEST_SECRET);

    // First registration succeeds
    await service.register("bob@example.com", "pw1", "Bob", "Bob Corp", "bob-corp", "US");

    // Second registration with the same email should fail
    const result = await service.register(
      "bob@example.com",
      "pw2",
      "Bob Again",
      "Bob Corp 2",
      "bob-corp-2",
      "US",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EMAIL_TAKEN");
  });
});

describe("SessionService — login", () => {
  it("returns a JWT token and user record when credentials are correct", async () => {
    const prisma = createMockPrisma();
    const service = createSessionService(prisma, TEST_SECRET);

    await service.register("carol@example.com", "correct-pw", "Carol", "Carol Corp", "carol-corp", "US");

    const result = await service.login("carol@example.com", "correct-pw");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.token).toBeTruthy();
    expect(result.value.user.email).toBe("carol@example.com");
  });

  it("returns INVALID_CREDENTIALS when the password is wrong", async () => {
    const prisma = createMockPrisma();
    const service = createSessionService(prisma, TEST_SECRET);

    await service.register("dave@example.com", "right-pw", "Dave", "Dave Corp", "dave-corp", "US");

    const result = await service.login("dave@example.com", "wrong-pw");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns INVALID_CREDENTIALS when the email does not exist", async () => {
    const prisma = createMockPrisma();
    const service = createSessionService(prisma, TEST_SECRET);

    const result = await service.login("ghost@example.com", "any-pw");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("SessionService — verifyToken", () => {
  it("returns the decoded payload for a valid token", async () => {
    const prisma = createMockPrisma();
    const service = createSessionService(prisma, TEST_SECRET);

    await service.register("eve@example.com", "pw", "Eve", "Eve Corp", "eve-corp", "US");
    const loginResult = await service.login("eve@example.com", "pw");
    expect(loginResult.ok).toBe(true);
    if (!loginResult.ok) return;

    const result = await service.verifyToken(loginResult.value.token);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.userId).toBeTruthy();
    expect(result.value.tenantId).toBeTruthy();
    expect(result.value.role).toBe("owner");
  });

  it("returns TOKEN_INVALID for a garbage token string", async () => {
    const prisma = createMockPrisma();
    const service = createSessionService(prisma, TEST_SECRET);

    const result = await service.verifyToken("this.is.not.a.valid.jwt");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TOKEN_INVALID");
  });

  it("returns TOKEN_EXPIRED for a token signed with a 0-second expiry", async () => {
    const prisma = createMockPrisma();
    const service = createSessionService(prisma, TEST_SECRET);

    // Create an already-expired token by signing with a past iat and exp
    const expiredToken = jwt.sign(
      { userId: "u1", tenantId: "t1", role: "owner", environment: "sandbox" },
      TEST_SECRET,
      { algorithm: "HS256", expiresIn: -1 },
    );

    const result = await service.verifyToken(expiredToken);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TOKEN_EXPIRED");
  });

  it("returns TOKEN_INVALID for a token signed with the wrong secret", async () => {
    const prisma = createMockPrisma();
    const service = createSessionService(prisma, TEST_SECRET);

    const wrongToken = jwt.sign(
      { userId: "u1", tenantId: "t1", role: "owner", environment: "sandbox" },
      "a-completely-different-secret",
      { algorithm: "HS256", expiresIn: 3600 },
    );

    const result = await service.verifyToken(wrongToken);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TOKEN_INVALID");
  });
});

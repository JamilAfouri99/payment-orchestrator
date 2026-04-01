import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTeamService } from "./team-service.js";

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

type DbInviteToken = {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  token: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

function makeLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function createMockPrisma() {
  const users = new Map<string, DbUser>();
  const teamMembers = new Map<string, DbTeamMember>();
  const inviteTokens = new Map<string, DbInviteToken>();
  const inviteTokensByToken = new Map<string, DbInviteToken>();

  return {
    _users: users,
    _teamMembers: teamMembers,
    _inviteTokens: inviteTokens,

    user: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Partial<DbUser> }) => {
        const row: DbUser = {
          id: data.id ?? "user_new",
          tenantId: data.tenantId ?? "tenant_1",
          email: data.email ?? "",
          passwordHash: data.passwordHash ?? "",
          name: data.name ?? "",
          role: data.role ?? "viewer",
          status: data.status ?? "active",
          emailVerified: data.emailVerified ?? false,
          lastLoginAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        users.set(row.id, row);
        return row;
      }),
      findMany: vi.fn().mockImplementation(
        async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => users.get(id)).filter((u): u is DbUser => u !== undefined),
      ),
      findUnique: vi.fn().mockImplementation(
        async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null,
      ),
      update: vi.fn().mockImplementation(
        async ({ where, data }: { where: { id: string }; data: Partial<DbUser> }) => {
          const existing = users.get(where.id);
          if (existing === undefined) throw new Error("Not found");
          const updated: DbUser = { ...existing, ...data };
          users.set(where.id, updated);
          return updated;
        },
      ),
    },

    teamMember: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Partial<DbTeamMember> }) => {
        const row: DbTeamMember = {
          id: data.id ?? "member_new",
          tenantId: data.tenantId ?? "tenant_1",
          userId: data.userId ?? "",
          role: data.role ?? "viewer",
          status: data.status ?? "active",
          invitedBy: null,
          invitedAt: data.invitedAt ?? null,
          acceptedAt: data.acceptedAt ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        teamMembers.set(row.id, row);
        return row;
      }),
      findMany: vi.fn().mockImplementation(
        async ({ where }: { where: { tenantId: string } }) =>
          [...teamMembers.values()].filter((m) => m.tenantId === where.tenantId),
      ),
      findFirst: vi.fn().mockImplementation(
        async ({ where }: { where: { id?: string; tenantId?: string; userId?: string } }) => {
          for (const m of teamMembers.values()) {
            if (where.id !== undefined && m.id !== where.id) continue;
            if (where.tenantId !== undefined && m.tenantId !== where.tenantId) continue;
            if (where.userId !== undefined && m.userId !== where.userId) continue;
            return m;
          }
          return null;
        },
      ),
      update: vi.fn().mockImplementation(
        async ({ where, data }: { where: { id: string }; data: Partial<DbTeamMember> }) => {
          const existing = teamMembers.get(where.id);
          if (existing === undefined) throw new Error("Not found");
          const updated: DbTeamMember = { ...existing, ...data, updatedAt: new Date() };
          teamMembers.set(where.id, updated);
          return updated;
        },
      ),
      delete: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        const existing = teamMembers.get(where.id);
        if (existing === undefined) throw new Error("Not found");
        teamMembers.delete(where.id);
        return existing;
      }),
    },

    inviteToken: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Partial<DbInviteToken> }) => {
        const row: DbInviteToken = {
          id: data.id ?? "invite_new",
          tenantId: data.tenantId ?? "tenant_1",
          email: data.email ?? "",
          role: data.role ?? "viewer",
          token: data.token ?? "tok_stub",
          expiresAt: data.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          usedAt: null,
          createdAt: new Date(),
        };
        inviteTokens.set(row.id, row);
        inviteTokensByToken.set(row.token, row);
        return row;
      }),
      findUnique: vi.fn().mockImplementation(
        async ({ where }: { where: { token: string } }) =>
          inviteTokensByToken.get(where.token) ?? null,
      ),
      update: vi.fn().mockImplementation(
        async ({ where, data }: { where: { id: string }; data: Partial<DbInviteToken> }) => {
          const existing = inviteTokens.get(where.id);
          if (existing === undefined) throw new Error("Not found");
          const updated: DbInviteToken = { ...existing, ...data };
          inviteTokens.set(where.id, updated);
          inviteTokensByToken.set(updated.token, updated);
          return updated;
        },
      ),
    },

    $transaction: vi.fn().mockImplementation(async (ops: Promise<unknown>[]) =>
      Promise.all(ops),
    ),
  } as unknown as import("@prisma/client").PrismaClient & {
    _users: Map<string, DbUser>;
    _teamMembers: Map<string, DbTeamMember>;
    _inviteTokens: Map<string, DbInviteToken>;
  };
}

describe("TeamService — invite", () => {
  it("creates an invite token with expiry approximately 7 days in the future", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createTeamService(prisma, logger as never);

    const result = await service.invite("tenant_1", "newmember@example.com", "developer", "user_owner");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const diff = result.value.expiresAt.getTime() - Date.now();
    expect(diff).toBeGreaterThan(sevenDaysMs - 5000);
    expect(diff).toBeLessThan(sevenDaysMs + 5000);
  });

  it("returns a token string with sufficient entropy (length > 20)", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createTeamService(prisma, logger as never);

    const result = await service.invite("tenant_1", "newmember@example.com", "developer", "user_owner");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.token.length).toBeGreaterThan(20);
  });
});

describe("TeamService — acceptInvite", () => {
  it("creates a user and team member when the invite is valid", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createTeamService(prisma, logger as never);

    const inviteResult = await service.invite("tenant_1", "invited@example.com", "developer", "user_owner");
    expect(inviteResult.ok).toBe(true);
    if (!inviteResult.ok) return;

    const result = await service.acceptInvite(inviteResult.value.token, "Invited User", "my-password");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.userId).toBeTruthy();
    expect(result.value.tenantId).toBe("tenant_1");
  });

  it("returns INVITE_EXPIRED when the token has already expired", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createTeamService(prisma, logger as never);

    // Manually seed an expired invite token
    const pastDate = new Date(Date.now() - 1000);
    const expiredToken = "expired_invite_token_abc";
    (prisma as unknown as { _inviteTokens: Map<string, unknown> })._inviteTokens.set("invite_exp", {
      id: "invite_exp",
      tenantId: "tenant_1",
      email: "exp@example.com",
      role: "viewer",
      token: expiredToken,
      expiresAt: pastDate,
      usedAt: null,
      createdAt: new Date(),
    });
    // Also set in the token map used by findUnique
    (prisma.inviteToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "invite_exp",
      tenantId: "tenant_1",
      email: "exp@example.com",
      role: "viewer",
      token: expiredToken,
      expiresAt: pastDate,
      usedAt: null,
      createdAt: new Date(),
    });

    const result = await service.acceptInvite(expiredToken, "Someone", "pw");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVITE_EXPIRED");
  });

  it("returns INVITE_USED when the token has already been used", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createTeamService(prisma, logger as never);

    const usedToken = "already_used_token_xyz";
    (prisma.inviteToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "invite_used",
      tenantId: "tenant_1",
      email: "used@example.com",
      role: "viewer",
      token: usedToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      usedAt: new Date(),
      createdAt: new Date(),
    });

    const result = await service.acceptInvite(usedToken, "Someone", "pw");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVITE_USED");
  });

  it("returns INVITE_EXPIRED for an unknown token", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createTeamService(prisma, logger as never);

    const result = await service.acceptInvite("completely-unknown-token", "Someone", "pw");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVITE_EXPIRED");
  });
});

describe("TeamService — listMembers", () => {
  it("returns all team members for the tenant with embedded user info", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createTeamService(prisma, logger as never);

    // Accept two invites to create two members
    const invite1 = await service.invite("tenant_1", "member1@example.com", "developer", "user_owner");
    const invite2 = await service.invite("tenant_1", "member2@example.com", "viewer", "user_owner");
    expect(invite1.ok && invite2.ok).toBe(true);
    if (!invite1.ok || !invite2.ok) return;

    await service.acceptInvite(invite1.value.token, "Member One", "pw");
    await service.acceptInvite(invite2.value.token, "Member Two", "pw");

    const result = await service.listMembers("tenant_1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(2);
    expect(result.value.every((m) => m.tenantId === "tenant_1")).toBe(true);
    expect(result.value.every((m) => m.user.id !== undefined)).toBe(true);
  });

  it("returns an empty array when no members exist", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createTeamService(prisma, logger as never);

    const result = await service.listMembers("tenant_nobody");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });
});

describe("TeamService — changeRole", () => {
  it("updates the member role and returns the updated record", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createTeamService(prisma, logger as never);

    const inviteResult = await service.invite("tenant_1", "member@example.com", "developer", "user_owner");
    expect(inviteResult.ok).toBe(true);
    if (!inviteResult.ok) return;

    const acceptResult = await service.acceptInvite(inviteResult.value.token, "Dev Member", "pw");
    expect(acceptResult.ok).toBe(true);
    if (!acceptResult.ok) return;

    // Find the created member in the store
    const members = [...(prisma as unknown as { _teamMembers: Map<string, DbTeamMember> })._teamMembers.values()];
    const member = members[0]!;

    // Set up owner in the team so the changeRole permission check passes
    const ownerUser: DbUser = {
      id: "user_owner",
      tenantId: "tenant_1",
      email: "owner@example.com",
      passwordHash: "hash",
      name: "Owner",
      role: "owner",
      status: "active",
      emailVerified: true,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const ownerMember: DbTeamMember = {
      id: "member_owner",
      tenantId: "tenant_1",
      userId: "user_owner",
      role: "owner",
      status: "active",
      invitedBy: null,
      invitedAt: null,
      acceptedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (prisma as unknown as { _teamMembers: Map<string, DbTeamMember> })._teamMembers.set("member_owner", ownerMember);
    (prisma as unknown as { _users: Map<string, DbUser> })._users.set("user_owner", ownerUser);

    const result = await service.changeRole("tenant_1", member.id, "finance", "user_owner");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.role).toBe("finance");
  });

  it("returns MEMBER_NOT_FOUND for an unknown member ID", async () => {
    const prisma = createMockPrisma();
    const logger = makeLogger();
    const service = createTeamService(prisma, logger as never);

    const result = await service.changeRole("tenant_1", "ghost-member-id", "viewer", "user_owner");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MEMBER_NOT_FOUND");
  });
});

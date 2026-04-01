import type { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import type { Logger } from "../core/logger.js";
import { hashPassword } from "./password.js";

const BASE62_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const INVITE_EXPIRY_DAYS = 7;

export interface TeamMemberRecord {
  id: string;
  tenantId: string;
  userId: string;
  role: string;
  status: string;
  invitedBy?: string | undefined;
  invitedAt?: Date | undefined;
  acceptedAt?: Date | undefined;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    email: string;
    name: string;
    status: string;
  };
}

export interface InviteTokenRecord {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  token: string;
  expiresAt: Date;
  usedAt?: Date | undefined;
  createdAt: Date;
}

export class TeamError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVITE_EXPIRED"
      | "INVITE_USED"
      | "MEMBER_NOT_FOUND"
      | "INSUFFICIENT_PERMISSION"
      | "PERSISTENCE_FAILED",
  ) {
    super(message);
    this.name = "TeamError";
  }
}

export interface TeamService {
  invite(
    tenantId: string,
    email: string,
    role: string,
    invitedBy: string,
  ): Promise<Result<InviteTokenRecord, TeamError>>;

  acceptInvite(
    token: string,
    name: string,
    password: string,
  ): Promise<Result<{ userId: string; tenantId: string }, TeamError>>;

  listMembers(tenantId: string): Promise<Result<TeamMemberRecord[], TeamError>>;

  changeRole(
    tenantId: string,
    memberId: string,
    newRole: string,
    changedBy: string,
  ): Promise<Result<TeamMemberRecord, TeamError>>;

  disableMember(memberId: string, tenantId: string): Promise<Result<void, TeamError>>;

  removeMember(memberId: string, tenantId: string): Promise<Result<void, TeamError>>;
}

function toBase62(buf: Buffer): string {
  let n = BigInt("0x" + buf.toString("hex"));
  let result = "";
  const base = BigInt(62);

  while (n > 0n) {
    const remainder = Number(n % base);
    result = (BASE62_CHARS[remainder] ?? "0") + result;
    n = n / base;
  }

  while (result.length < 64) {
    result = "0" + result;
  }

  return result;
}

function toInviteRecord(r: {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  token: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}): InviteTokenRecord {
  return {
    id: r.id,
    tenantId: r.tenantId,
    email: r.email,
    role: r.role,
    token: r.token,
    expiresAt: r.expiresAt,
    ...(r.usedAt !== null ? { usedAt: r.usedAt } : {}),
    createdAt: r.createdAt,
  };
}

export function createTeamService(prisma: PrismaClient, logger: Logger): TeamService {
  return {
    async invite(tenantId, email, role, invitedBy) {
      try {
        const token = toBase62(randomBytes(48));
        const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

        const record = await prisma.inviteToken.create({
          data: {
            id: uuid(),
            tenantId,
            email,
            role,
            token,
            expiresAt,
          },
        });

        logger.info("team_invite_sent", {
          tenantId,
          email,
          role,
          invitedBy,
          expiresAt: expiresAt.toISOString(),
        });

        return ok(toInviteRecord(record));
      } catch (error) {
        return err(new TeamError(
          `Failed to create invite: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },

    async acceptInvite(token, name, password) {
      const invite = await prisma.inviteToken.findUnique({ where: { token } });

      if (invite === null) {
        return err(new TeamError("Invite token not found or already used", "INVITE_EXPIRED"));
      }

      if (invite.usedAt !== null) {
        return err(new TeamError("Invite token has already been used", "INVITE_USED"));
      }

      if (invite.expiresAt < new Date()) {
        return err(new TeamError("Invite token has expired", "INVITE_EXPIRED"));
      }

      try {
        const passwordHash = await hashPassword(password);
        const userId = uuid();
        const memberId = uuid();

        await prisma.$transaction([
          prisma.user.create({
            data: {
              id: userId,
              tenantId: invite.tenantId,
              email: invite.email,
              passwordHash,
              name,
              role: invite.role,
              status: "active",
              emailVerified: false,
            },
          }),
          prisma.teamMember.create({
            data: {
              id: memberId,
              tenantId: invite.tenantId,
              userId,
              role: invite.role,
              status: "active",
              invitedAt: invite.createdAt,
              acceptedAt: new Date(),
            },
          }),
          prisma.inviteToken.update({
            where: { id: invite.id },
            data: { usedAt: new Date() },
          }),
        ]);

        logger.info("team_invite_accepted", {
          tenantId: invite.tenantId,
          userId,
          email: invite.email,
          role: invite.role,
        });

        return ok({ userId, tenantId: invite.tenantId });
      } catch (error) {
        return err(new TeamError(
          `Failed to accept invite: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },

    async listMembers(tenantId) {
      try {
        const members = await prisma.teamMember.findMany({
          where: { tenantId },
          orderBy: { createdAt: "asc" },
        });

        const userIds = members.map((m) => m.userId);
        const users = await prisma.user.findMany({
          where: { id: { in: userIds } },
        });

        const userMap = new Map(users.map((u) => [u.id, u]));

        const records: TeamMemberRecord[] = [];
        for (const member of members) {
          const user = userMap.get(member.userId);
          if (user === undefined) continue;

          records.push({
            id: member.id,
            tenantId: member.tenantId,
            userId: member.userId,
            role: member.role,
            status: member.status,
            ...(member.invitedBy !== null ? { invitedBy: member.invitedBy } : {}),
            ...(member.invitedAt !== null ? { invitedAt: member.invitedAt } : {}),
            ...(member.acceptedAt !== null ? { acceptedAt: member.acceptedAt } : {}),
            createdAt: member.createdAt,
            updatedAt: member.updatedAt,
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              status: user.status,
            },
          });
        }

        return ok(records);
      } catch (error) {
        return err(new TeamError(
          `Failed to list members: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },

    async changeRole(tenantId, memberId, newRole, changedBy) {
      try {
        const member = await prisma.teamMember.findFirst({
          where: { id: memberId, tenantId },
        });

        if (member === null) {
          return err(new TeamError(`Member "${memberId}" not found`, "MEMBER_NOT_FOUND"));
        }

        // Only owners can grant the owner role
        if (newRole === "owner") {
          const changer = await prisma.teamMember.findFirst({
            where: { userId: changedBy, tenantId },
          });
          if (changer === null || changer.role !== "owner") {
            return err(new TeamError(
              "Only owners can assign the owner role",
              "INSUFFICIENT_PERMISSION",
            ));
          }
        }

        const updated = await prisma.teamMember.update({
          where: { id: memberId },
          data: { role: newRole },
        });

        // Keep User.role in sync
        await prisma.user.update({
          where: { id: updated.userId },
          data: { role: newRole },
        });

        const user = await prisma.user.findUnique({ where: { id: updated.userId } });

        return ok({
          id: updated.id,
          tenantId: updated.tenantId,
          userId: updated.userId,
          role: updated.role,
          status: updated.status,
          ...(updated.invitedBy !== null ? { invitedBy: updated.invitedBy } : {}),
          ...(updated.invitedAt !== null ? { invitedAt: updated.invitedAt } : {}),
          ...(updated.acceptedAt !== null ? { acceptedAt: updated.acceptedAt } : {}),
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
          user: {
            id: user?.id ?? updated.userId,
            email: user?.email ?? "",
            name: user?.name ?? "",
            status: user?.status ?? "active",
          },
        });
      } catch (error) {
        return err(new TeamError(
          `Failed to change role: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },

    async disableMember(memberId, tenantId) {
      try {
        const member = await prisma.teamMember.findFirst({
          where: { id: memberId, tenantId },
        });

        if (member === null) {
          return err(new TeamError(`Member "${memberId}" not found`, "MEMBER_NOT_FOUND"));
        }

        await prisma.$transaction([
          prisma.teamMember.update({
            where: { id: memberId },
            data: { status: "disabled" },
          }),
          prisma.user.update({
            where: { id: member.userId },
            data: { status: "disabled" },
          }),
        ]);

        return ok(undefined);
      } catch (error) {
        return err(new TeamError(
          `Failed to disable member: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },

    async removeMember(memberId, tenantId) {
      try {
        const member = await prisma.teamMember.findFirst({
          where: { id: memberId, tenantId },
        });

        if (member === null) {
          return err(new TeamError(`Member "${memberId}" not found`, "MEMBER_NOT_FOUND"));
        }

        await prisma.teamMember.delete({ where: { id: memberId } });

        return ok(undefined);
      } catch (error) {
        return err(new TeamError(
          `Failed to remove member: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },
  };
}

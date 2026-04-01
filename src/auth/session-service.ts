import type { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import { hashPassword, verifyPassword } from "./password.js";
import { createTenantService } from "../tenancy/tenant-service.js";
import { createApiKeyService } from "./api-key-service.js";

export interface TokenPayload {
  userId: string;
  tenantId: string;
  role: string;
  environment: "sandbox" | "production";
  iat: number;
  exp: number;
}

export interface UserRecord {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: string;
  status: string;
  emailVerified: boolean;
  lastLoginAt?: Date | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_CREDENTIALS"
      | "EMAIL_TAKEN"
      | "USER_NOT_FOUND"
      | "TOKEN_INVALID"
      | "TOKEN_EXPIRED",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface RegisterResult {
  token: string;
  user: UserRecord;
  tenant: {
    id: string;
    name: string;
    slug: string;
    plan: string;
  };
  apiKey: {
    fullKey: string;
    keyPrefix: string;
    environment: string;
  };
}

export interface SessionService {
  register(
    email: string,
    password: string,
    name: string,
    tenantName: string,
    slug: string,
    country: string,
  ): Promise<Result<RegisterResult, AuthError>>;

  login(
    email: string,
    password: string,
  ): Promise<Result<{ token: string; user: UserRecord }, AuthError>>;

  verifyToken(token: string): Promise<Result<TokenPayload, AuthError>>;

  getUser(userId: string): Promise<Result<UserRecord, AuthError>>;
}

const JWT_EXPIRY_SECONDS = 86400; // 24 hours

function toUserRecord(r: {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: string;
  status: string;
  emailVerified: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): UserRecord {
  return {
    id: r.id,
    tenantId: r.tenantId,
    email: r.email,
    name: r.name,
    role: r.role,
    status: r.status,
    emailVerified: r.emailVerified,
    ...(r.lastLoginAt !== null ? { lastLoginAt: r.lastLoginAt } : {}),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function signToken(
  payload: Omit<TokenPayload, "iat" | "exp">,
  secret: string,
): string {
  return jwt.sign(payload, secret, {
    algorithm: "HS256",
    expiresIn: JWT_EXPIRY_SECONDS,
  });
}

export function createSessionService(
  prisma: PrismaClient,
  jwtSecret: string,
): SessionService {
  const tenantService = createTenantService(prisma);
  const apiKeyService = createApiKeyService(prisma);

  return {
    async register(email, password, name, tenantName, slug, _country) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing !== null) {
        return err(new AuthError(`Email "${email}" is already registered`, "EMAIL_TAKEN"));
      }

      const tenantResult = await tenantService.createTenant(tenantName, slug);
      if (!tenantResult.ok) {
        const code = tenantResult.error.code === "SLUG_TAKEN" ? "EMAIL_TAKEN" : "EMAIL_TAKEN";
        return err(new AuthError(tenantResult.error.message, code));
      }

      const { tenant, merchantAccount } = tenantResult.value;
      const passwordHash = await hashPassword(password);
      const userId = uuid();

      const [user] = await prisma.$transaction([
        prisma.user.create({
          data: {
            id: userId,
            tenantId: tenant.id,
            email,
            passwordHash,
            name,
            role: "owner",
            status: "active",
            emailVerified: false,
          },
        }),
        prisma.teamMember.create({
          data: {
            id: uuid(),
            tenantId: tenant.id,
            userId,
            role: "owner",
            status: "active",
          },
        }),
      ]);

      const apiKeyResult = await apiKeyService.generate(tenant.id, {
        environment: "sandbox",
        name: "Default sandbox key",
        merchantAccountId: merchantAccount.id,
        createdBy: userId,
      });

      if (!apiKeyResult.ok) {
        return err(new AuthError(
          `Account created but API key generation failed: ${apiKeyResult.error.message}`,
          "TOKEN_INVALID",
        ));
      }

      const token = signToken(
        {
          userId: user.id,
          tenantId: tenant.id,
          role: user.role,
          environment: "sandbox",
        },
        jwtSecret,
      );

      return ok({
        token,
        user: toUserRecord(user),
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          plan: tenant.plan,
        },
        apiKey: {
          fullKey: apiKeyResult.value.fullKey,
          keyPrefix: apiKeyResult.value.record.keyPrefix,
          environment: apiKeyResult.value.record.environment,
        },
      });
    },

    async login(email, password) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user === null) {
        return err(new AuthError("Invalid email or password", "INVALID_CREDENTIALS"));
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return err(new AuthError("Invalid email or password", "INVALID_CREDENTIALS"));
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      const token = signToken(
        {
          userId: user.id,
          tenantId: user.tenantId,
          role: user.role,
          environment: "sandbox",
        },
        jwtSecret,
      );

      return ok({ token, user: toUserRecord(user) });
    },

    async verifyToken(token) {
      try {
        const decoded = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
        return ok(decoded as TokenPayload);
      } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
          return err(new AuthError("Token has expired", "TOKEN_EXPIRED"));
        }
        return err(new AuthError("Token is invalid", "TOKEN_INVALID"));
      }
    },

    async getUser(userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user === null) {
        return err(new AuthError(`User "${userId}" not found`, "USER_NOT_FOUND"));
      }
      return ok(toUserRecord(user));
    },
  };
}

import type { Request, Response, NextFunction } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "../core/logger.js";
import type { ProblemDetails } from "../core/types.js";
import type { ApiKeyService } from "./api-key-service.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import { DEFAULT_TENANT_ID } from "../tenancy/tenant-context.js";

// Augment Express Request to carry tenant context
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenantContext?: TenantContext | undefined;
    }
  }
}

interface ApiKeyAuthDeps {
  prisma: PrismaClient;
  apiKeyService: ApiKeyService;
  logger: Logger;
}

function unauthorized(res: Response, detail: string): void {
  const problem: ProblemDetails = {
    type: "https://payment-orchestrator.dev/problems/unauthorized",
    title: "Unauthorized",
    status: 401,
    detail,
  };
  res.status(401).json(problem);
}

function forbidden(res: Response, detail: string): void {
  const problem: ProblemDetails = {
    type: "https://payment-orchestrator.dev/problems/forbidden",
    title: "Forbidden",
    status: 403,
    detail,
  };
  res.status(403).json(problem);
}

export function createApiKeyAuthMiddleware(deps: ApiKeyAuthDeps) {
  const { prisma, apiKeyService, logger } = deps;

  return async function apiKeyAuthMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const authHeader = req.headers["authorization"];

    // Dev bypass when no Authorization header is present
    if (authHeader === undefined || authHeader === "") {
      if (process.env["NODE_ENV"] === "development") {
        const tenant = await prisma.tenant.findUnique({
          where: { id: DEFAULT_TENANT_ID },
        });

        req.tenantContext = {
          tenantId: DEFAULT_TENANT_ID,
          environment: "sandbox",
          plan: tenant?.plan ?? "free",
        };

        logger.debug("api_key_auth_bypassed", { tenantId: DEFAULT_TENANT_ID });
        next();
        return;
      }

      unauthorized(res, "Authorization header is required");
      return;
    }

    if (!authHeader.startsWith("Bearer ")) {
      unauthorized(res, "Authorization header must use Bearer scheme");
      return;
    }

    const rawKey = authHeader.slice(7).trim();
    if (rawKey === "") {
      unauthorized(res, "API key must not be empty");
      return;
    }

    const validationResult = await apiKeyService.validate(rawKey);
    if (!validationResult.ok) {
      const code = validationResult.error.code;
      if (code === "KEY_REVOKED") {
        unauthorized(res, "API key has been revoked");
        return;
      }
      if (code === "KEY_EXPIRED") {
        unauthorized(res, "API key has expired");
        return;
      }
      unauthorized(res, "Invalid API key");
      return;
    }

    const { tenantId, merchantAccountId, environment, permissions } = validationResult.value;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (tenant === null) {
      logger.error("api_key_tenant_missing", { tenantId, keyId: validationResult.value.keyId });
      unauthorized(res, "Associated tenant not found");
      return;
    }

    if (tenant.status === "suspended") {
      forbidden(res, "Tenant account is suspended");
      return;
    }

    req.tenantContext = {
      tenantId,
      ...(merchantAccountId !== undefined ? { merchantAccountId } : {}),
      environment: environment as "sandbox" | "production",
      plan: tenant.plan,
      permissions,
    } as TenantContext & { permissions: string[] };

    next();
  };
}

export function createPermissionMiddleware(requiredPermission: string) {
  return function permissionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const ctx = req.tenantContext as (TenantContext & { permissions?: string[] | undefined }) | undefined;

    if (ctx === undefined) {
      unauthorized(res, "Authentication required");
      return;
    }

    const permissions: string[] = ctx.permissions ?? [];
    const granted = permissions.some((p) => matchesPermission(p, requiredPermission));

    if (!granted) {
      forbidden(res, `Permission "${requiredPermission}" is required`);
      return;
    }

    next();
  };
}

function matchesPermission(granted: string, requested: string): boolean {
  if (granted === "*") return true;
  if (granted === requested) return true;
  if (granted.endsWith(":*")) {
    const prefix = granted.slice(0, -1);
    return requested.startsWith(prefix);
  }
  return false;
}

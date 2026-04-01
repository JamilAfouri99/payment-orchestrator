import type { Request, Response, NextFunction } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "../core/logger.js";
import type { ProblemDetails } from "../core/types.js";
import type { ApiKeyService } from "./api-key-service.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import { DEFAULT_TENANT_ID } from "../tenancy/tenant-context.js";
import type { CacheService } from "../cache/cache-service.js";

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
  cache?: CacheService | undefined;
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

const API_KEY_CACHE_TTL = 300; // 5 minutes
const TENANT_CACHE_TTL = 600; // 10 minutes

export function createApiKeyAuthMiddleware(deps: ApiKeyAuthDeps) {
  const { prisma, apiKeyService, logger, cache } = deps;

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

    // Check cache for validated API key
    const cacheKey = `apikey:${rawKey.slice(0, 8)}:${rawKey.slice(-4)}`;
    type CachedKeyResult = { tenantId: string; merchantAccountId?: string | undefined; environment: string; permissions: string[]; keyId: string };
    const cached = cache ? await cache.get<CachedKeyResult>(cacheKey) : null;

    let keyData: CachedKeyResult;
    if (cached) {
      keyData = cached;
    } else {
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
      keyData = {
        tenantId: validationResult.value.tenantId,
        environment: validationResult.value.environment,
        permissions: validationResult.value.permissions,
        keyId: validationResult.value.keyId,
        ...(validationResult.value.merchantAccountId !== undefined
          ? { merchantAccountId: validationResult.value.merchantAccountId }
          : {}),
      };
      if (cache) {
        await cache.set(cacheKey, keyData, API_KEY_CACHE_TTL);
      }
    }

    const { tenantId, merchantAccountId, environment, permissions } = keyData;

    // Check cache for tenant
    const tenantCacheKey = `tenant:${tenantId}`;
    type CachedTenant = { id: string; plan: string; status: string };
    let tenant = cache ? await cache.get<CachedTenant>(tenantCacheKey) : null;
    if (!tenant) {
      const dbTenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (dbTenant === null) {
        logger.error("api_key_tenant_missing", { tenantId, keyId: keyData.keyId });
        unauthorized(res, "Associated tenant not found");
        return;
      }
      tenant = { id: dbTenant.id, plan: dbTenant.plan, status: dbTenant.status };
      if (cache) {
        await cache.set(tenantCacheKey, tenant, TENANT_CACHE_TTL);
      }
    }

    if (tenant === null) {
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

import type { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  merchantAccountId?: string | undefined;
  keyPrefix: string;
  environment: string;
  permissions: string[];
  status: string;
  name: string;
  expiresAt?: Date | undefined;
  lastUsedAt?: Date | undefined;
  createdBy?: string | undefined;
  revokedBy?: string | undefined;
  revokedAt?: Date | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface GenerateOpts {
  environment: "sandbox" | "production";
  name?: string | undefined;
  permissions?: string[] | undefined;
  merchantAccountId?: string | undefined;
  expiresAt?: Date | undefined;
  createdBy?: string | undefined;
}

export interface ValidatedKey {
  tenantId: string;
  merchantAccountId?: string | undefined;
  environment: string;
  permissions: string[];
  keyId: string;
}

export class ApiKeyError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_KEY"
      | "KEY_EXPIRED"
      | "KEY_REVOKED"
      | "RATE_LIMITED"
      | "GENERATION_FAILED",
  ) {
    super(message);
    this.name = "ApiKeyError";
  }
}

export interface ApiKeyService {
  generate(
    tenantId: string,
    opts: GenerateOpts,
  ): Promise<Result<{ fullKey: string; record: ApiKeyRecord }, ApiKeyError>>;

  validate(rawKey: string): Promise<Result<ValidatedKey, ApiKeyError>>;

  revoke(
    keyId: string,
    revokedBy: string,
  ): Promise<Result<void, ApiKeyError>>;

  listByTenant(tenantId: string): Promise<Result<ApiKeyRecord[], ApiKeyError>>;
}

const BASE62_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const BCRYPT_ROUNDS = 12;
const PREFIX_QUERY_LENGTH = 8;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  validatedAt: number;
  result: ValidatedKey;
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

  // Pad to ensure consistent length for 32-byte input
  while (result.length < 43) {
    result = "0" + result;
  }

  return result;
}

function toApiKeyRecord(r: {
  id: string;
  tenantId: string;
  merchantAccountId: string | null;
  keyPrefix: string;
  environment: string;
  permissions: unknown;
  status: string;
  name: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdBy: string | null;
  revokedBy: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ApiKeyRecord {
  return {
    id: r.id,
    tenantId: r.tenantId,
    ...(r.merchantAccountId !== null ? { merchantAccountId: r.merchantAccountId } : {}),
    keyPrefix: r.keyPrefix,
    environment: r.environment,
    permissions: r.permissions as string[],
    status: r.status,
    name: r.name,
    ...(r.expiresAt !== null ? { expiresAt: r.expiresAt } : {}),
    ...(r.lastUsedAt !== null ? { lastUsedAt: r.lastUsedAt } : {}),
    ...(r.createdBy !== null ? { createdBy: r.createdBy } : {}),
    ...(r.revokedBy !== null ? { revokedBy: r.revokedBy } : {}),
    ...(r.revokedAt !== null ? { revokedAt: r.revokedAt } : {}),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function createApiKeyService(prisma: PrismaClient): ApiKeyService {
  const cache = new Map<string, CacheEntry>();

  function getCached(rawKey: string): ValidatedKey | undefined {
    const entry = cache.get(rawKey);
    if (entry === undefined) return undefined;
    if (Date.now() - entry.validatedAt > CACHE_TTL_MS) {
      cache.delete(rawKey);
      return undefined;
    }
    return entry.result;
  }

  function setCached(rawKey: string, result: ValidatedKey): void {
    cache.set(rawKey, { validatedAt: Date.now(), result });
  }

  return {
    async generate(tenantId, opts) {
      try {
        const prefix = opts.environment === "production" ? "pk_live_" : "pk_test_";
        const random = toBase62(randomBytes(32));
        const fullKey = prefix + random;
        const keyPrefix = fullKey.slice(0, 12);
        const keyHash = await bcrypt.hash(fullKey, BCRYPT_ROUNDS);

        const permissions = opts.permissions ?? ["payments:read", "payments:write"];

        const record = await prisma.apiKey.create({
          data: {
            id: uuid(),
            tenantId,
            keyPrefix,
            keyHash,
            environment: opts.environment,
            permissions,
            name: opts.name ?? "",
            ...(opts.merchantAccountId !== undefined ? { merchantAccountId: opts.merchantAccountId } : {}),
            ...(opts.expiresAt !== undefined ? { expiresAt: opts.expiresAt } : {}),
            ...(opts.createdBy !== undefined ? { createdBy: opts.createdBy } : {}),
          },
        });

        return ok({ fullKey, record: toApiKeyRecord(record) });
      } catch (error) {
        return err(new ApiKeyError(
          `Failed to generate API key: ${error instanceof Error ? error.message : String(error)}`,
          "GENERATION_FAILED",
        ));
      }
    },

    async validate(rawKey) {
      const cached = getCached(rawKey);
      if (cached !== undefined) return ok(cached);

      if (rawKey.length < PREFIX_QUERY_LENGTH) {
        return err(new ApiKeyError("Invalid API key format", "INVALID_KEY"));
      }

      const queryPrefix = rawKey.slice(0, PREFIX_QUERY_LENGTH);

      const candidates = await prisma.apiKey.findMany({
        where: {
          keyPrefix: { startsWith: queryPrefix },
          status: "active",
        },
      });

      for (const candidate of candidates) {
        const match = await bcrypt.compare(rawKey, candidate.keyHash);
        if (!match) continue;

        if (candidate.status === "revoked") {
          return err(new ApiKeyError("API key has been revoked", "KEY_REVOKED"));
        }

        if (candidate.expiresAt !== null && candidate.expiresAt < new Date()) {
          return err(new ApiKeyError("API key has expired", "KEY_EXPIRED"));
        }

        // Update last used timestamp without blocking
        prisma.apiKey
          .update({
            where: { id: candidate.id },
            data: { lastUsedAt: new Date() },
          })
          .catch(() => undefined);

        const result: ValidatedKey = {
          tenantId: candidate.tenantId,
          ...(candidate.merchantAccountId !== null
            ? { merchantAccountId: candidate.merchantAccountId }
            : {}),
          environment: candidate.environment,
          permissions: candidate.permissions as string[],
          keyId: candidate.id,
        };

        setCached(rawKey, result);
        return ok(result);
      }

      return err(new ApiKeyError("Invalid API key", "INVALID_KEY"));
    },

    async revoke(keyId, revokedBy) {
      try {
        await prisma.apiKey.update({
          where: { id: keyId },
          data: {
            status: "revoked",
            revokedAt: new Date(),
            revokedBy,
          },
        });

        // Evict any cached entries for this key — we don't have the raw key
        // so we clear all entries whose result.keyId matches
        for (const [k, v] of cache.entries()) {
          if (v.result.keyId === keyId) {
            cache.delete(k);
          }
        }

        return ok(undefined);
      } catch (error) {
        return err(new ApiKeyError(
          `Failed to revoke key: ${error instanceof Error ? error.message : String(error)}`,
          "INVALID_KEY",
        ));
      }
    },

    async listByTenant(tenantId) {
      try {
        const records = await prisma.apiKey.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
        });
        return ok(records.map(toApiKeyRecord));
      } catch (error) {
        return err(new ApiKeyError(
          `Failed to list API keys: ${error instanceof Error ? error.message : String(error)}`,
          "GENERATION_FAILED",
        ));
      }
    },
  };
}

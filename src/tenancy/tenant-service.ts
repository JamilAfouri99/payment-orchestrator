import type { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  defaultCurrency: string;
  timezone: string;
  webhookSecret: string;
  trialExpiresAt?: Date | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface MerchantAccountRecord {
  id: string;
  tenantId: string;
  name: string;
  environment: string;
  status: string;
  mcc?: string | undefined;
  businessType?: string | undefined;
  riskTier: string;
  settlementCurrency: string;
  payoutSchedule: string;
  createdAt: Date;
  updatedAt: Date;
}

export class TenantServiceError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "SLUG_TAKEN" | "PERSISTENCE_FAILED",
  ) {
    super(message);
    this.name = "TenantServiceError";
  }
}

export interface CreateTenantOpts {
  plan?: string | undefined;
  defaultCurrency?: string | undefined;
  timezone?: string | undefined;
  trialExpiresAt?: Date | undefined;
}

export interface UpdateTenantOpts {
  name?: string | undefined;
  status?: string | undefined;
  plan?: string | undefined;
  defaultCurrency?: string | undefined;
  timezone?: string | undefined;
}

export interface CreateMerchantAccountOpts {
  mcc?: string | undefined;
  businessType?: string | undefined;
  riskTier?: string | undefined;
  settlementCurrency?: string | undefined;
  payoutSchedule?: string | undefined;
}

export interface TenantService {
  createTenant(
    name: string,
    slug: string,
    opts?: CreateTenantOpts | undefined,
  ): Promise<Result<{ tenant: TenantRecord; merchantAccount: MerchantAccountRecord }, TenantServiceError>>;

  getTenant(id: string): Promise<Result<TenantRecord, TenantServiceError>>;

  getTenantBySlug(slug: string): Promise<Result<TenantRecord, TenantServiceError>>;

  updateTenant(
    id: string,
    updates: UpdateTenantOpts,
  ): Promise<Result<TenantRecord, TenantServiceError>>;

  createMerchantAccount(
    tenantId: string,
    name: string,
    environment: string,
    opts?: CreateMerchantAccountOpts | undefined,
  ): Promise<Result<MerchantAccountRecord, TenantServiceError>>;

  getMerchantAccounts(tenantId: string): Promise<Result<MerchantAccountRecord[], TenantServiceError>>;

  getMerchantAccount(id: string): Promise<Result<MerchantAccountRecord, TenantServiceError>>;
}

function toTenantRecord(r: {
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
}): TenantRecord {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    plan: r.plan,
    defaultCurrency: r.defaultCurrency,
    timezone: r.timezone,
    webhookSecret: r.webhookSecret,
    ...(r.trialExpiresAt !== null ? { trialExpiresAt: r.trialExpiresAt } : {}),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toMerchantAccountRecord(r: {
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
}): MerchantAccountRecord {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    environment: r.environment,
    status: r.status,
    ...(r.mcc !== null ? { mcc: r.mcc } : {}),
    ...(r.businessType !== null ? { businessType: r.businessType } : {}),
    riskTier: r.riskTier,
    settlementCurrency: r.settlementCurrency,
    payoutSchedule: r.payoutSchedule,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function createTenantService(prisma: PrismaClient): TenantService {
  return {
    async createTenant(name, slug, opts) {
      try {
        const existing = await prisma.tenant.findUnique({ where: { slug } });
        if (existing !== null) {
          return err(new TenantServiceError(`Slug "${slug}" is already taken`, "SLUG_TAKEN"));
        }

        const tenantId = uuid();
        const merchantAccountId = uuid();
        const webhookSecret = randomBytes(32).toString("hex");

        const [tenant, merchantAccount] = await prisma.$transaction([
          prisma.tenant.create({
            data: {
              id: tenantId,
              name,
              slug,
              webhookSecret,
              ...(opts?.plan !== undefined ? { plan: opts.plan } : {}),
              ...(opts?.defaultCurrency !== undefined ? { defaultCurrency: opts.defaultCurrency } : {}),
              ...(opts?.timezone !== undefined ? { timezone: opts.timezone } : {}),
              ...(opts?.trialExpiresAt !== undefined ? { trialExpiresAt: opts.trialExpiresAt } : {}),
            },
          }),
          prisma.merchantAccount.create({
            data: {
              id: merchantAccountId,
              tenantId,
              name: `${name} (Sandbox)`,
              environment: "sandbox",
            },
          }),
        ]);

        return ok({
          tenant: toTenantRecord(tenant),
          merchantAccount: toMerchantAccountRecord(merchantAccount),
        });
      } catch (error) {
        return err(new TenantServiceError(
          `Failed to create tenant: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },

    async getTenant(id) {
      try {
        const tenant = await prisma.tenant.findUnique({ where: { id } });
        if (tenant === null) {
          return err(new TenantServiceError(`Tenant "${id}" not found`, "NOT_FOUND"));
        }
        return ok(toTenantRecord(tenant));
      } catch (error) {
        return err(new TenantServiceError(
          `Failed to get tenant: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },

    async getTenantBySlug(slug) {
      try {
        const tenant = await prisma.tenant.findUnique({ where: { slug } });
        if (tenant === null) {
          return err(new TenantServiceError(`Tenant with slug "${slug}" not found`, "NOT_FOUND"));
        }
        return ok(toTenantRecord(tenant));
      } catch (error) {
        return err(new TenantServiceError(
          `Failed to get tenant by slug: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },

    async updateTenant(id, updates) {
      try {
        const tenant = await prisma.tenant.update({
          where: { id },
          data: {
            ...(updates.name !== undefined ? { name: updates.name } : {}),
            ...(updates.status !== undefined ? { status: updates.status } : {}),
            ...(updates.plan !== undefined ? { plan: updates.plan } : {}),
            ...(updates.defaultCurrency !== undefined ? { defaultCurrency: updates.defaultCurrency } : {}),
            ...(updates.timezone !== undefined ? { timezone: updates.timezone } : {}),
          },
        });
        return ok(toTenantRecord(tenant));
      } catch (error) {
        const isNotFound =
          error instanceof Error && error.message.includes("Record to update not found");
        return err(new TenantServiceError(
          isNotFound
            ? `Tenant "${id}" not found`
            : `Failed to update tenant: ${error instanceof Error ? error.message : String(error)}`,
          isNotFound ? "NOT_FOUND" : "PERSISTENCE_FAILED",
        ));
      }
    },

    async createMerchantAccount(tenantId, name, environment, opts) {
      try {
        const record = await prisma.merchantAccount.create({
          data: {
            id: uuid(),
            tenantId,
            name,
            environment,
            ...(opts?.mcc !== undefined ? { mcc: opts.mcc } : {}),
            ...(opts?.businessType !== undefined ? { businessType: opts.businessType } : {}),
            ...(opts?.riskTier !== undefined ? { riskTier: opts.riskTier } : {}),
            ...(opts?.settlementCurrency !== undefined ? { settlementCurrency: opts.settlementCurrency } : {}),
            ...(opts?.payoutSchedule !== undefined ? { payoutSchedule: opts.payoutSchedule } : {}),
          },
        });
        return ok(toMerchantAccountRecord(record));
      } catch (error) {
        return err(new TenantServiceError(
          `Failed to create merchant account: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },

    async getMerchantAccounts(tenantId) {
      try {
        const records = await prisma.merchantAccount.findMany({
          where: { tenantId },
          orderBy: { createdAt: "asc" },
        });
        return ok(records.map(toMerchantAccountRecord));
      } catch (error) {
        return err(new TenantServiceError(
          `Failed to list merchant accounts: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },

    async getMerchantAccount(id) {
      try {
        const record = await prisma.merchantAccount.findUnique({ where: { id } });
        if (record === null) {
          return err(new TenantServiceError(`Merchant account "${id}" not found`, "NOT_FOUND"));
        }
        return ok(toMerchantAccountRecord(record));
      } catch (error) {
        return err(new TenantServiceError(
          `Failed to get merchant account: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },
  };
}

import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import type { Logger } from "../core/logger.js";
import type { TenantService } from "../tenancy/tenant-service.js";
import type { SessionService } from "./session-service.js";
import type { ApiKeyService } from "./api-key-service.js";

export interface KybDetails {
  businessName: string;
  businessType: string;
  country: string;
  registrationNumber?: string | undefined;
  taxId?: string | undefined;
  website?: string | undefined;
  address?: string | undefined;
  phone?: string | undefined;
  representativeName?: string | undefined;
  representativeDob?: string | undefined;
}

export interface KybApplicationRecord {
  id: string;
  tenantId: string;
  businessName: string;
  businessType: string;
  country: string;
  status: string;
  registrationNumber?: string | undefined;
  taxId?: string | undefined;
  website?: string | undefined;
  address?: string | undefined;
  phone?: string | undefined;
  representativeName?: string | undefined;
  representativeDob?: string | undefined;
  reviewedAt?: Date | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConfigureOpts {
  providers?: string[] | undefined;
  fraudSensitivity?: "low" | "medium" | "high" | undefined;
  settlementCurrency?: string | undefined;
  payoutSchedule?: string | undefined;
}

export interface GoLiveResult {
  productionApiKey: { fullKey: string; keyPrefix: string };
  productionMerchantAccountId: string;
}

export class OnboardingError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "KYB_NOT_APPROVED"
      | "KYB_NOT_FOUND"
      | "TENANT_NOT_FOUND"
      | "ALREADY_LIVE"
      | "PERSISTENCE_FAILED",
  ) {
    super(message);
    this.name = "OnboardingError";
  }
}

export interface OnboardingService {
  submitKyb(
    tenantId: string,
    details: KybDetails,
  ): Promise<Result<KybApplicationRecord, OnboardingError>>;

  getKybStatus(tenantId: string): Promise<Result<KybApplicationRecord | null, OnboardingError>>;

  configure(
    tenantId: string,
    config: ConfigureOpts,
  ): Promise<Result<void, OnboardingError>>;

  goLive(tenantId: string): Promise<Result<GoLiveResult, OnboardingError>>;
}

// Fraud sensitivity presets define which rules to enable and with what weights
interface FraudPreset {
  velocity?: { enabled: boolean; weight: number; config: Record<string, unknown> } | undefined;
  amount_anomaly?: { enabled: boolean; weight: number; config: Record<string, unknown> } | undefined;
  high_value?: { enabled: boolean; weight: number; config: Record<string, unknown> } | undefined;
  geo_mismatch?: { enabled: boolean; weight: number; config: Record<string, unknown> } | undefined;
  new_customer?: { enabled: boolean; weight: number; config: Record<string, unknown> } | undefined;
}

const FRAUD_PRESETS: Record<"low" | "medium" | "high", FraudPreset> = {
  low: {
    high_value: { enabled: true, weight: 10, config: { thresholdCents: 100_000 } },
    new_customer: { enabled: true, weight: 5, config: {} },
    velocity: { enabled: false, weight: 30, config: { maxPayments: 5, windowMinutes: 10 } },
    amount_anomaly: { enabled: false, weight: 25, config: { multiplier: 3 } },
    geo_mismatch: { enabled: false, weight: 20, config: {} },
  },
  medium: {
    velocity: { enabled: true, weight: 30, config: { maxPayments: 5, windowMinutes: 10 } },
    amount_anomaly: { enabled: true, weight: 25, config: { multiplier: 3 } },
    high_value: { enabled: true, weight: 15, config: { thresholdCents: 100_000 } },
    geo_mismatch: { enabled: true, weight: 20, config: {} },
    new_customer: { enabled: true, weight: 10, config: {} },
  },
  high: {
    velocity: { enabled: true, weight: 60, config: { maxPayments: 5, windowMinutes: 10 } },
    amount_anomaly: { enabled: true, weight: 50, config: { multiplier: 3 } },
    high_value: { enabled: true, weight: 30, config: { thresholdCents: 50_000 } },
    geo_mismatch: { enabled: true, weight: 40, config: {} },
    new_customer: { enabled: true, weight: 20, config: {} },
  },
};

const RULE_NAMES: Record<string, string> = {
  velocity: "Velocity Check",
  amount_anomaly: "Amount Anomaly",
  high_value: "High Value Transaction",
  geo_mismatch: "Geographic Mismatch",
  new_customer: "New Customer",
};

const RULE_DESCRIPTIONS: Record<string, string> = {
  velocity: "Flag if customer exceeds payment count in time window",
  amount_anomaly: "Flag if amount exceeds 3x customer average",
  high_value: "Flag transactions over threshold",
  geo_mismatch: "Flag if payment region differs from customer usual region",
  new_customer: "Flag first-time customers",
};

function toKybRecord(r: {
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
}): KybApplicationRecord {
  return {
    id: r.id,
    tenantId: r.tenantId,
    businessName: r.businessName,
    businessType: r.businessType,
    country: r.country,
    status: r.status,
    ...(r.registrationNumber !== null ? { registrationNumber: r.registrationNumber } : {}),
    ...(r.taxId !== null ? { taxId: r.taxId } : {}),
    ...(r.website !== null ? { website: r.website } : {}),
    ...(r.address !== null ? { address: r.address } : {}),
    ...(r.phone !== null ? { phone: r.phone } : {}),
    ...(r.representativeName !== null ? { representativeName: r.representativeName } : {}),
    ...(r.representativeDob !== null ? { representativeDob: r.representativeDob } : {}),
    ...(r.reviewedAt !== null ? { reviewedAt: r.reviewedAt } : {}),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function createOnboardingService(deps: {
  prisma: PrismaClient;
  tenantService: TenantService;
  sessionService: SessionService;
  apiKeyService: ApiKeyService;
  logger: Logger;
}): OnboardingService {
  const { prisma, tenantService, apiKeyService, logger } = deps;

  async function applyFraudPreset(
    tenantId: string,
    sensitivity: "low" | "medium" | "high",
  ): Promise<void> {
    const preset = FRAUD_PRESETS[sensitivity];
    const ruleTypes = Object.keys(preset) as Array<keyof FraudPreset>;

    for (const ruleType of ruleTypes) {
      const rule = preset[ruleType];
      if (rule === undefined) continue;

      const existing = await prisma.fraudRule.findFirst({
        where: { tenantId, ruleType },
      });

      if (existing !== null) {
        await prisma.fraudRule.update({
          where: { id: existing.id },
          data: {
            weight: rule.weight,
            enabled: rule.enabled,
            config: rule.config as object,
          },
        });
      } else {
        await prisma.fraudRule.create({
          data: {
            id: uuid(),
            tenantId,
            name: RULE_NAMES[ruleType] ?? ruleType,
            description: RULE_DESCRIPTIONS[ruleType] ?? "",
            ruleType,
            config: rule.config as object,
            weight: rule.weight,
            enabled: rule.enabled,
          },
        });
      }
    }
  }

  return {
    async submitKyb(tenantId, details) {
      try {
        const applicationId = uuid();
        const record = await prisma.kybApplication.create({
          data: {
            id: applicationId,
            tenantId,
            businessName: details.businessName,
            businessType: details.businessType,
            country: details.country,
            ...(details.registrationNumber !== undefined ? { registrationNumber: details.registrationNumber } : {}),
            ...(details.taxId !== undefined ? { taxId: details.taxId } : {}),
            ...(details.website !== undefined ? { website: details.website } : {}),
            ...(details.address !== undefined ? { address: details.address } : {}),
            ...(details.phone !== undefined ? { phone: details.phone } : {}),
            ...(details.representativeName !== undefined ? { representativeName: details.representativeName } : {}),
            ...(details.representativeDob !== undefined ? { representativeDob: details.representativeDob } : {}),
            status: "pending",
          },
        });

        logger.info("kyb_submitted", { tenantId, applicationId });

        // Simulate auto-approval after 5 seconds
        setTimeout(() => {
          prisma.kybApplication
            .update({
              where: { id: applicationId },
              data: { status: "approved", reviewedAt: new Date() },
            })
            .then(() => {
              logger.info("kyb_auto_approved", { tenantId, applicationId });
            })
            .catch((error: unknown) => {
              logger.error("kyb_auto_approve_failed", {
                tenantId,
                applicationId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
        }, 5000);

        return ok(toKybRecord(record));
      } catch (error) {
        return err(new OnboardingError(
          `Failed to submit KYB: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },

    async getKybStatus(tenantId) {
      try {
        const record = await prisma.kybApplication.findFirst({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
        });
        if (record === null) return ok(null);
        return ok(toKybRecord(record));
      } catch (error) {
        return err(new OnboardingError(
          `Failed to get KYB status: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },

    async configure(tenantId, config) {
      try {
        const accounts = await prisma.merchantAccount.findMany({
          where: { tenantId, environment: "sandbox" },
          orderBy: { createdAt: "asc" },
        });

        const sandboxAccount = accounts[0];
        if (sandboxAccount !== undefined) {
          await prisma.merchantAccount.update({
            where: { id: sandboxAccount.id },
            data: {
              ...(config.settlementCurrency !== undefined
                ? { settlementCurrency: config.settlementCurrency }
                : {}),
              ...(config.payoutSchedule !== undefined
                ? { payoutSchedule: config.payoutSchedule }
                : {}),
            },
          });
        }

        if (config.fraudSensitivity !== undefined) {
          await applyFraudPreset(tenantId, config.fraudSensitivity);
        }

        if (config.providers !== undefined && config.providers.length > 0) {
          logger.info("tenant_providers_configured", {
            tenantId,
            providers: config.providers,
          });
        }

        return ok(undefined);
      } catch (error) {
        return err(new OnboardingError(
          `Failed to configure tenant: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },

    async goLive(tenantId) {
      const kyb = await prisma.kybApplication.findFirst({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      });

      if (kyb === null) {
        return err(new OnboardingError("No KYB application found for tenant", "KYB_NOT_FOUND"));
      }

      if (kyb.status !== "approved") {
        return err(new OnboardingError(
          `KYB application is not approved (current status: ${kyb.status})`,
          "KYB_NOT_APPROVED",
        ));
      }

      const tenantResult = await tenantService.getTenant(tenantId);
      if (!tenantResult.ok) {
        return err(new OnboardingError(`Tenant not found: ${tenantId}`, "TENANT_NOT_FOUND"));
      }

      if (tenantResult.value.status === "active") {
        return err(new OnboardingError("Tenant is already live", "ALREADY_LIVE"));
      }

      try {
        const prodAccountResult = await tenantService.createMerchantAccount(
          tenantId,
          `${tenantResult.value.name} (Production)`,
          "production",
        );

        if (!prodAccountResult.ok) {
          return err(new OnboardingError(
            `Failed to create production merchant account: ${prodAccountResult.error.message}`,
            "PERSISTENCE_FAILED",
          ));
        }

        const apiKeyResult = await apiKeyService.generate(tenantId, {
          environment: "production",
          name: "Default production key",
          merchantAccountId: prodAccountResult.value.id,
        });

        if (!apiKeyResult.ok) {
          return err(new OnboardingError(
            `Failed to generate production API key: ${apiKeyResult.error.message}`,
            "PERSISTENCE_FAILED",
          ));
        }

        await tenantService.updateTenant(tenantId, { status: "active" });

        logger.info("tenant_went_live", { tenantId });

        return ok({
          productionApiKey: {
            fullKey: apiKeyResult.value.fullKey,
            keyPrefix: apiKeyResult.value.record.keyPrefix,
          },
          productionMerchantAccountId: prodAccountResult.value.id,
        });
      } catch (error) {
        return err(new OnboardingError(
          `Go-live failed: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },
  };
}

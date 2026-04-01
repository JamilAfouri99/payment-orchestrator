import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ThreeDSecureVersion = "3ds1" | "3ds2";
export type ThreeDSecureStatus = "challenge_required" | "frictionless" | "authenticated" | "failed" | "attempted";
export type ECI = "05" | "06" | "07";

export interface ThreeDSecureRecord {
  id: string;
  tenantId: string;
  paymentId: string;
  version: ThreeDSecureVersion;
  status: ThreeDSecureStatus;
  eci: ECI;
  cavv: string;
  dsTransId: string;
  challengeUrl: string;
  liabilityShift: boolean;
  completedAt: Date | null;
  createdAt: Date;
}

export interface ThreeDSecureParams {
  amount: number;
  currency: string;
  region?: string | undefined;
  fraudScore?: number | undefined;
  isTrustedBeneficiary?: boolean | undefined;
  version?: ThreeDSecureVersion | undefined;
}

export interface ThreeDSecureCheckParams {
  amount: number;
  currency: string;
  region?: string | undefined;
  fraudScore?: number | undefined;
  isTrustedBeneficiary?: boolean | undefined;
}

export class ThreeDSecureError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "ALREADY_COMPLETED" | "INTERNAL",
  ) {
    super(message);
    this.name = "ThreeDSecureError";
  }
}

export interface ThreeDSecureService {
  initiate(paymentId: string, params: ThreeDSecureParams): Promise<Result<ThreeDSecureRecord, ThreeDSecureError>>;
  complete(threeDSecureId: string, outcome: "authenticated" | "failed"): Promise<Result<ThreeDSecureRecord, ThreeDSecureError>>;
  check(paymentId: string): Promise<Result<ThreeDSecureRecord | null, ThreeDSecureError>>;
  shouldRequire(params: ThreeDSecureCheckParams): boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const EU_REGIONS = ["EU", "DE", "FR", "IT", "ES", "NL", "BE", "AT", "IE", "PT", "FI", "GR", "LU", "SK", "SI", "EE", "LV", "LT", "MT", "CY"];
const HIGH_RISK_FRAUD_THRESHOLD = 60;
const LOW_VALUE_THRESHOLD_CENTS = 3000; // 30 EUR equivalent
const SOMETIMES_THRESHOLD_CENTS = 10000; // 100 EUR equivalent

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateCavv(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let i = 0; i < 28; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateDsTransId(): string {
  return `ds-${uuid().replace(/-/g, "").slice(0, 24)}`;
}

function deterministic3dsHash(paymentId: string): number {
  let hash = 0;
  for (let i = 0; i < paymentId.length; i++) {
    hash = ((hash << 5) - hash + paymentId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100;
}

function toRecord(row: Record<string, unknown>): ThreeDSecureRecord {
  return {
    id: row["id"] as string,
    tenantId: row["tenantId"] as string,
    paymentId: row["paymentId"] as string,
    version: row["version"] as ThreeDSecureVersion,
    status: row["status"] as ThreeDSecureStatus,
    eci: row["eci"] as ECI,
    cavv: row["cavv"] as string,
    dsTransId: row["dsTransId"] as string,
    challengeUrl: row["challengeUrl"] as string,
    liabilityShift: row["liabilityShift"] as boolean,
    completedAt: row["completedAt"] as Date | null,
    createdAt: row["createdAt"] as Date,
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createThreeDSecureService(
  prisma: PrismaClient,
  tenantId: string,
): ThreeDSecureService {
  function shouldRequire(params: ThreeDSecureCheckParams): boolean {
    // Trusted beneficiary: never require
    if (params.isTrustedBeneficiary) return false;

    // Low-value exemption: never require
    if (params.amount < LOW_VALUE_THRESHOLD_CENTS) return false;

    // EU region (PSD2/SCA): always require
    const region = params.region ?? "US";
    if (EU_REGIONS.includes(region)) return true;

    // High fraud score: always require
    if (params.fraudScore !== undefined && params.fraudScore > HIGH_RISK_FRAUD_THRESHOLD) return true;

    // Medium-value: sometimes require (50% based on deterministic hash)
    if (params.amount >= SOMETIMES_THRESHOLD_CENTS) {
      return deterministic3dsHash(`${params.amount}:${params.currency}`) < 50;
    }

    // Default: sometimes (20%)
    return deterministic3dsHash(`${params.amount}:${params.currency}:default`) < 20;
  }

  return {
    shouldRequire,

    async initiate(paymentId, params) {
      try {
        const version = params.version ?? "3ds2";
        const isEu = EU_REGIONS.includes(params.region ?? "US");
        const isHighRisk = (params.fraudScore ?? 0) > HIGH_RISK_FRAUD_THRESHOLD;

        // Determine initial status: frictionless for low-risk 3DS2, challenge for everything else
        const isFrictionless = version === "3ds2" && !isHighRisk && !isEu && params.amount < SOMETIMES_THRESHOLD_CENTS;
        const status: ThreeDSecureStatus = isFrictionless ? "frictionless" : "challenge_required";

        // ECI: 05 for full auth, 06 for attempted/3DS1
        const eci: ECI = version === "3ds1" ? "06" : "05";

        const id = uuid();
        const dsTransId = generateDsTransId();
        const challengeUrl = status === "challenge_required"
          ? `/3ds/challenge/${id}`
          : "";

        const record = await prisma.threeDSecure.create({
          data: {
            id,
            tenantId,
            paymentId,
            version,
            status,
            eci,
            cavv: isFrictionless ? generateCavv() : "",
            dsTransId,
            challengeUrl,
            liabilityShift: isFrictionless,
            completedAt: isFrictionless ? new Date() : null,
          },
        });

        return ok(toRecord(record as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new ThreeDSecureError(
          `Failed to initiate 3DS: ${e instanceof Error ? e.message : String(e)}`,
          "INTERNAL",
        ));
      }
    },

    async complete(threeDSecureId, outcome) {
      try {
        const existing = await prisma.threeDSecure.findFirst({
          where: { id: threeDSecureId, tenantId },
        });

        if (!existing) {
          return err(new ThreeDSecureError("3DS record not found", "NOT_FOUND"));
        }

        if (existing.status === "authenticated" || existing.status === "failed") {
          return err(new ThreeDSecureError("3DS already completed", "ALREADY_COMPLETED"));
        }

        const isAuthenticated = outcome === "authenticated";
        const status: ThreeDSecureStatus = isAuthenticated ? "authenticated" : "failed";
        const liabilityShift = isAuthenticated && existing.eci === "05";

        const updated = await prisma.threeDSecure.update({
          where: { id: threeDSecureId },
          data: {
            status,
            cavv: isAuthenticated ? generateCavv() : "",
            liabilityShift,
            completedAt: new Date(),
          },
        });

        return ok(toRecord(updated as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new ThreeDSecureError(
          `Failed to complete 3DS: ${e instanceof Error ? e.message : String(e)}`,
          "INTERNAL",
        ));
      }
    },

    async check(paymentId) {
      try {
        const record = await prisma.threeDSecure.findFirst({
          where: { tenantId, paymentId },
          orderBy: { createdAt: "desc" },
        });

        if (!record) return ok(null);
        return ok(toRecord(record as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new ThreeDSecureError(
          `Failed to check 3DS: ${e instanceof Error ? e.message : String(e)}`,
          "INTERNAL",
        ));
      }
    },
  };
}

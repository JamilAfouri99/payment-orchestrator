import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LineItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface CheckoutCustomer {
  email?: string | undefined;
  name?: string | undefined;
  billingAddress?: string | undefined;
}

export interface CheckoutSessionRecord {
  id: string;
  tenantId: string;
  merchantAccountId: string;
  amount: number;
  currency: string;
  description: string;
  lineItems: LineItem[];
  customer: CheckoutCustomer;
  allowedPaymentMethods: string[];
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
  status: string;
  paymentId: string | null;
  paymentMethodType: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSessionInput {
  amount: number;
  currency?: string | undefined;
  description?: string | undefined;
  lineItems?: LineItem[] | undefined;
  customer?: CheckoutCustomer | undefined;
  allowedPaymentMethods?: string[] | undefined;
  successUrl?: string | undefined;
  cancelUrl?: string | undefined;
  merchantAccountId?: string | undefined;
  expiresInMinutes?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface ConversionStats {
  totalSessions: number;
  completedSessions: number;
  expiredSessions: number;
  openSessions: number;
  conversionRate: number;
  avgCompletionTimeMs: number;
  byPaymentMethod: Record<string, { count: number; percentage: number }>;
}

export class CheckoutError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "VALIDATION" | "EXPIRED" | "ALREADY_COMPLETE" | "INTERNAL",
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

export interface CheckoutService {
  createSession(input: CreateSessionInput): Promise<Result<CheckoutSessionRecord, CheckoutError>>;
  getSession(sessionId: string): Promise<Result<CheckoutSessionRecord, CheckoutError>>;
  completeSession(sessionId: string, paymentId: string, paymentMethodType: string): Promise<Result<CheckoutSessionRecord, CheckoutError>>;
  expireSession(sessionId: string): Promise<Result<void, CheckoutError>>;
  listSessions(params?: { status?: string | undefined; limit?: number | undefined }): Promise<Result<CheckoutSessionRecord[], CheckoutError>>;
  getConversionStats(): Promise<Result<ConversionStats, CheckoutError>>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_EXPIRY_MINUTES = 30;
const VALID_PAYMENT_METHODS = ["card", "bank_transfer", "wallet", "bnpl", "crypto"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toRecord(row: Record<string, unknown>): CheckoutSessionRecord {
  return {
    id: row["id"] as string,
    tenantId: row["tenantId"] as string,
    merchantAccountId: row["merchantAccountId"] as string,
    amount: row["amount"] as number,
    currency: row["currency"] as string,
    description: row["description"] as string,
    lineItems: (row["lineItems"] as LineItem[]) ?? [],
    customer: (row["customer"] as CheckoutCustomer) ?? {},
    allowedPaymentMethods: (row["allowedPaymentMethods"] as string[]) ?? ["card"],
    successUrl: row["successUrl"] as string,
    cancelUrl: row["cancelUrl"] as string,
    expiresAt: row["expiresAt"] as Date,
    status: row["status"] as string,
    paymentId: (row["paymentId"] as string | null) ?? null,
    paymentMethodType: (row["paymentMethodType"] as string | null) ?? null,
    metadata: (row["metadata"] as Record<string, unknown>) ?? {},
    createdAt: row["createdAt"] as Date,
    updatedAt: row["updatedAt"] as Date,
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createCheckoutService(
  prisma: PrismaClient,
  tenantId: string,
): CheckoutService {
  return {
    async createSession(input) {
      if (!input.amount || input.amount <= 0) {
        return err(new CheckoutError("Amount must be a positive integer", "VALIDATION"));
      }

      const currency = input.currency ?? "USD";
      if (currency.length !== 3) {
        return err(new CheckoutError("Currency must be a 3-letter ISO code", "VALIDATION"));
      }

      const methods = input.allowedPaymentMethods ?? ["card"];
      for (const m of methods) {
        if (!VALID_PAYMENT_METHODS.includes(m)) {
          return err(new CheckoutError(`Invalid payment method: ${m}`, "VALIDATION"));
        }
      }

      // Validate line items total matches amount if provided
      if (input.lineItems && input.lineItems.length > 0) {
        const itemTotal = input.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
        if (itemTotal !== input.amount) {
          return err(new CheckoutError(
            `Line items total (${itemTotal}) does not match amount (${input.amount})`,
            "VALIDATION",
          ));
        }
      }

      try {
        const id = uuid();
        const expiresInMinutes = input.expiresInMinutes ?? DEFAULT_EXPIRY_MINUTES;
        const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

        const record = await prisma.checkoutSession.create({
          data: {
            id,
            tenantId,
            merchantAccountId: input.merchantAccountId ?? "default",
            amount: input.amount,
            currency,
            description: input.description ?? "",
            lineItems: (input.lineItems ?? []) as unknown as import("@prisma/client").Prisma.InputJsonValue,
            customer: (input.customer ?? {}) as unknown as import("@prisma/client").Prisma.InputJsonValue,
            allowedPaymentMethods: methods as unknown as import("@prisma/client").Prisma.InputJsonValue,
            successUrl: input.successUrl ?? "",
            cancelUrl: input.cancelUrl ?? "",
            expiresAt,
            status: "open",
            metadata: (input.metadata ?? {}) as unknown as import("@prisma/client").Prisma.InputJsonValue,
          },
        });

        return ok(toRecord(record as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new CheckoutError(
          `Failed to create session: ${e instanceof Error ? e.message : String(e)}`,
          "INTERNAL",
        ));
      }
    },

    async getSession(sessionId) {
      try {
        const record = await prisma.checkoutSession.findFirst({
          where: { id: sessionId, tenantId },
        });
        if (!record) {
          return err(new CheckoutError("Session not found", "NOT_FOUND"));
        }

        // Auto-expire if past TTL
        if (record.status === "open" && new Date() > record.expiresAt) {
          const updated = await prisma.checkoutSession.update({
            where: { id: sessionId },
            data: { status: "expired" },
          });
          return ok(toRecord(updated as unknown as Record<string, unknown>));
        }

        return ok(toRecord(record as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new CheckoutError(
          `Failed to get session: ${e instanceof Error ? e.message : String(e)}`,
          "INTERNAL",
        ));
      }
    },

    async completeSession(sessionId, paymentId, paymentMethodType) {
      try {
        const record = await prisma.checkoutSession.findFirst({
          where: { id: sessionId, tenantId },
        });

        if (!record) {
          return err(new CheckoutError("Session not found", "NOT_FOUND"));
        }

        if (record.status === "complete") {
          return err(new CheckoutError("Session already completed", "ALREADY_COMPLETE"));
        }

        if (record.status === "expired" || new Date() > record.expiresAt) {
          await prisma.checkoutSession.update({
            where: { id: sessionId },
            data: { status: "expired" },
          });
          return err(new CheckoutError("Session has expired", "EXPIRED"));
        }

        const updated = await prisma.checkoutSession.update({
          where: { id: sessionId },
          data: {
            status: "complete",
            paymentId,
            paymentMethodType,
          },
        });

        return ok(toRecord(updated as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new CheckoutError(
          `Failed to complete session: ${e instanceof Error ? e.message : String(e)}`,
          "INTERNAL",
        ));
      }
    },

    async expireSession(sessionId) {
      try {
        const record = await prisma.checkoutSession.findFirst({
          where: { id: sessionId, tenantId },
        });

        if (!record) {
          return err(new CheckoutError("Session not found", "NOT_FOUND"));
        }

        if (record.status === "complete") {
          return err(new CheckoutError("Cannot expire a completed session", "ALREADY_COMPLETE"));
        }

        await prisma.checkoutSession.update({
          where: { id: sessionId },
          data: { status: "expired" },
        });

        return ok(undefined);
      } catch (e) {
        return err(new CheckoutError(
          `Failed to expire session: ${e instanceof Error ? e.message : String(e)}`,
          "INTERNAL",
        ));
      }
    },

    async listSessions(params) {
      try {
        const where: Record<string, unknown> = { tenantId };
        if (params?.status) where["status"] = params.status;

        const records = await prisma.checkoutSession.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: params?.limit ?? 50,
        });

        return ok(records.map((r) => toRecord(r as unknown as Record<string, unknown>)));
      } catch (e) {
        return err(new CheckoutError(
          `Failed to list sessions: ${e instanceof Error ? e.message : String(e)}`,
          "INTERNAL",
        ));
      }
    },

    async getConversionStats() {
      try {
        const sessions = await prisma.checkoutSession.findMany({
          where: { tenantId },
        });

        const total = sessions.length;
        const completed = sessions.filter((s) => s.status === "complete");
        const expired = sessions.filter((s) => s.status === "expired");
        const open = sessions.filter((s) => s.status === "open");

        // Average completion time
        let totalCompletionTime = 0;
        for (const s of completed) {
          totalCompletionTime += s.updatedAt.getTime() - s.createdAt.getTime();
        }
        const avgCompletionTimeMs = completed.length > 0
          ? Math.round(totalCompletionTime / completed.length)
          : 0;

        // By payment method
        const byMethod: Record<string, number> = {};
        for (const s of completed) {
          const method = s.paymentMethodType ?? "unknown";
          byMethod[method] = (byMethod[method] ?? 0) + 1;
        }

        const byPaymentMethod: Record<string, { count: number; percentage: number }> = {};
        for (const [method, count] of Object.entries(byMethod)) {
          byPaymentMethod[method] = {
            count,
            percentage: completed.length > 0 ? Math.round((count / completed.length) * 10000) / 100 : 0,
          };
        }

        return ok({
          totalSessions: total,
          completedSessions: completed.length,
          expiredSessions: expired.length,
          openSessions: open.length,
          conversionRate: total > 0 ? Math.round((completed.length / total) * 10000) / 100 : 0,
          avgCompletionTimeMs,
          byPaymentMethod,
        });
      } catch (e) {
        return err(new CheckoutError(
          `Failed to get stats: ${e instanceof Error ? e.message : String(e)}`,
          "INTERNAL",
        ));
      }
    },
  };
}

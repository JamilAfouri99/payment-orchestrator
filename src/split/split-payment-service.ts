import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import type { LedgerService } from "../ledger/ledger-service.js";
import type { EventStore } from "../events/event-store.js";
import type { WebhookDeliveryService } from "../webhooks/webhook-delivery.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type RecipientType = "merchant" | "platform" | "third_party";
export type SplitType = "fixed" | "percentage";
export type SplitStatus = "pending" | "executed" | "failed";

export interface PaymentSplit {
  id: string;
  tenantId: string;
  paymentId: string;
  recipientType: RecipientType;
  recipientId: string;
  amount: number;
  currency: string;
  splitType: SplitType;
  description: string;
  status: SplitStatus;
  ledgerTxId: string | null;
  createdAt: string;
}

export interface SplitInput {
  recipientType: RecipientType;
  recipientId: string;
  amount: number;
  currency?: string | undefined;
  splitType?: SplitType | undefined;
  description?: string | undefined;
}

// ── Error ────────────────────────────────────────────────────────────────────

export class SplitError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_STATUS"
      | "VALIDATION"
      | "SPLIT_FAILURE",
  ) {
    super(message);
    this.name = "SplitError";
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_RECIPIENT_TYPES: RecipientType[] = ["merchant", "platform", "third_party"];

// ── Service Interface ────────────────────────────────────────────────────────

export interface SplitPaymentService {
  configureSplits(
    paymentId: string,
    paymentAmount: number,
    splits: SplitInput[],
  ): Promise<Result<PaymentSplit[], SplitError>>;

  executeSplits(paymentId: string): Promise<Result<PaymentSplit[], SplitError>>;

  getSplits(paymentId: string): Promise<Result<PaymentSplit[], SplitError>>;

  validateSplits(paymentAmount: number, splits: SplitInput[]): Result<void, SplitError>;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createSplitPaymentService(
  prisma: PrismaClient,
  tenantId: string,
  ledgerService: LedgerService,
  eventStore: EventStore,
  webhookService: WebhookDeliveryService,
): SplitPaymentService {

  function toSplit(record: {
    id: string;
    tenantId: string;
    paymentId: string;
    recipientType: string;
    recipientId: string;
    amount: number;
    currency: string;
    splitType: string;
    description: string;
    status: string;
    ledgerTxId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): PaymentSplit {
    return {
      id: record.id,
      tenantId: record.tenantId,
      paymentId: record.paymentId,
      recipientType: record.recipientType as RecipientType,
      recipientId: record.recipientId,
      amount: record.amount,
      currency: record.currency,
      splitType: record.splitType as SplitType,
      description: record.description,
      status: record.status as SplitStatus,
      ledgerTxId: record.ledgerTxId,
      createdAt: record.createdAt.toISOString(),
    };
  }

  async function getNextEventVersion(aggregateId: string): Promise<number> {
    const existing = await eventStore.getByAggregateId(aggregateId);
    if (!existing.ok) return 1;
    return existing.value.length + 1;
  }

  return {
    validateSplits(paymentAmount, splits) {
      if (splits.length < 2) {
        return err(new SplitError("At least 2 splits required", "VALIDATION"));
      }

      for (const split of splits) {
        if (!split.recipientType || !VALID_RECIPIENT_TYPES.includes(split.recipientType)) {
          return err(new SplitError(
            `Invalid recipientType: ${split.recipientType}. Must be one of: ${VALID_RECIPIENT_TYPES.join(", ")}`,
            "VALIDATION",
          ));
        }
        if (!split.recipientId) {
          return err(new SplitError("recipientId is required for each split", "VALIDATION"));
        }
        if (!Number.isInteger(split.amount) || split.amount <= 0) {
          return err(new SplitError(`Split amount must be a positive integer, got ${split.amount}`, "VALIDATION"));
        }
      }

      const total = splits.reduce((sum, s) => sum + s.amount, 0);
      if (total !== paymentAmount) {
        return err(new SplitError(
          `Split amounts (${total}) must equal payment total (${paymentAmount})`,
          "VALIDATION",
        ));
      }

      return ok(undefined);
    },

    async configureSplits(paymentId, paymentAmount, splits) {
      const validation = this.validateSplits(paymentAmount, splits);
      if (!validation.ok) return err(validation.error);

      // Check for existing splits
      const existing = await prisma.paymentSplit.findMany({
        where: { tenantId, paymentId },
      });
      if (existing.length > 0) {
        const hasExecuted = existing.some((s) => s.status === "executed");
        if (hasExecuted) {
          return err(new SplitError("Splits already executed for this payment", "INVALID_STATUS"));
        }
        // Delete pending splits to allow reconfiguration
        await prisma.paymentSplit.deleteMany({
          where: { tenantId, paymentId, status: "pending" },
        });
      }

      try {
        const records: PaymentSplit[] = [];
        for (const split of splits) {
          const record = await prisma.paymentSplit.create({
            data: {
              id: uuid(),
              tenantId,
              paymentId,
              recipientType: split.recipientType,
              recipientId: split.recipientId,
              amount: split.amount,
              currency: split.currency ?? "USD",
              splitType: split.splitType ?? "fixed",
              description: split.description ?? "",
              status: "pending",
            },
          });
          records.push(toSplit(record));
        }

        // Append event
        const version = await getNextEventVersion(paymentId);
        await eventStore.append({
          aggregateId: paymentId,
          aggregateType: "PaymentSplit",
          eventType: "SplitsConfigured",
          version,
          payload: { paymentId, splitCount: splits.length, totalAmount: paymentAmount },
          metadata: {},
        });

        // Dispatch webhook
        await webhookService.dispatch("split.configured", {
          paymentId,
          splits: records,
        });

        return ok(records);
      } catch (error) {
        return err(new SplitError(
          `Failed to configure splits: ${error instanceof Error ? error.message : String(error)}`,
          "SPLIT_FAILURE",
        ));
      }
    },

    async executeSplits(paymentId) {
      const splits = await prisma.paymentSplit.findMany({
        where: { tenantId, paymentId },
      });

      if (splits.length === 0) {
        return err(new SplitError(`No splits found for payment ${paymentId}`, "NOT_FOUND"));
      }

      const hasExecuted = splits.some((s) => s.status === "executed");
      if (hasExecuted) {
        return err(new SplitError("Splits already executed for this payment", "INVALID_STATUS"));
      }

      try {
        const results: PaymentSplit[] = [];

        for (const split of splits) {
          // Determine ledger accounts based on recipient type
          const creditAccount = split.recipientType === "platform"
            ? "platform_fees"
            : "merchant_balance";

          const ledgerResult = await ledgerService.postTransactionByName(
            "fee",
            `split:${paymentId}:${split.id}`,
            [
              { accountName: "provider_settlement", direction: "debit", amount: split.amount, currency: split.currency },
              { accountName: creditAccount, direction: "credit", amount: split.amount, currency: split.currency },
            ],
            `Split payment ${paymentId} → ${split.recipientType}:${split.recipientId}`,
          );

          if (!ledgerResult.ok) {
            await prisma.paymentSplit.update({
              where: { id: split.id },
              data: { status: "failed" },
            });
            results.push(toSplit({
              ...split,
              status: "failed",
              createdAt: split.createdAt,
              updatedAt: new Date(),
            }));
            continue;
          }

          const updated = await prisma.paymentSplit.update({
            where: { id: split.id },
            data: { status: "executed", ledgerTxId: ledgerResult.value.id },
          });
          results.push(toSplit(updated));
        }

        // Append event
        const version = await getNextEventVersion(paymentId);
        await eventStore.append({
          aggregateId: paymentId,
          aggregateType: "PaymentSplit",
          eventType: "SplitsExecuted",
          version,
          payload: {
            paymentId,
            executed: results.filter((r) => r.status === "executed").length,
            failed: results.filter((r) => r.status === "failed").length,
          },
          metadata: {},
        });

        await webhookService.dispatch("split.executed", {
          paymentId,
          splits: results,
        });

        return ok(results);
      } catch (error) {
        return err(new SplitError(
          `Failed to execute splits: ${error instanceof Error ? error.message : String(error)}`,
          "SPLIT_FAILURE",
        ));
      }
    },

    async getSplits(paymentId) {
      try {
        const splits = await prisma.paymentSplit.findMany({
          where: { tenantId, paymentId },
          orderBy: { createdAt: "asc" },
        });
        return ok(splits.map(toSplit));
      } catch (error) {
        return err(new SplitError(
          `Failed to get splits: ${error instanceof Error ? error.message : String(error)}`,
          "SPLIT_FAILURE",
        ));
      }
    },
  };
}

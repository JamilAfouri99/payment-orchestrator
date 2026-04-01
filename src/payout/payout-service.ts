import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import type { LedgerService } from "../ledger/ledger-service.js";
import type { EventStore } from "../events/event-store.js";
import type { WebhookDeliveryService } from "../webhooks/webhook-delivery.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type PayoutAccountType = "bank_account" | "wallet";
export type PayoutAccountStatus = "pending_verification" | "verified" | "disabled";

export type PayoutStatus = "pending" | "processing" | "in_transit" | "paid" | "failed" | "canceled";

export interface PayoutAccount {
  id: string;
  tenantId: string;
  merchantAccountId: string;
  type: PayoutAccountType;
  bankName: string;
  accountNumberMasked: string;
  routingNumber: string;
  currency: string;
  country: string;
  status: PayoutAccountStatus;
  isDefault: boolean;
  createdAt: string;
}

export interface Payout {
  id: string;
  tenantId: string;
  merchantAccountId: string;
  payoutAccountId: string;
  amount: number;
  currency: string;
  fees: number;
  status: PayoutStatus;
  scheduledAt: string | null;
  initiatedAt: string | null;
  arrivedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  retryCount: number;
  settlementIds: string[];
  ledgerTransactionId: string | null;
  createdAt: string;
}

export interface PayoutAccountInput {
  merchantAccountId: string;
  type?: PayoutAccountType | undefined;
  bankName: string;
  accountNumberLast4: string;
  routingNumber: string;
  currency?: string | undefined;
  country?: string | undefined;
}

export interface SchedulePayoutInput {
  merchantAccountId: string;
  payoutAccountId?: string | undefined;
  amount: number;
  currency?: string | undefined;
  settlementIds?: string[] | undefined;
}

export interface PayoutFilters {
  status?: PayoutStatus | undefined;
  merchantAccountId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

// ── Error ────────────────────────────────────────────────────────────────────

export class PayoutError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_STATUS"
      | "VALIDATION"
      | "PAYOUT_FAILURE",
  ) {
    super(message);
    this.name = "PayoutError";
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_PAYOUT_TRANSITIONS: Record<PayoutStatus, PayoutStatus[]> = {
  pending: ["processing", "canceled"],
  processing: ["in_transit", "failed"],
  in_transit: ["paid", "failed"],
  paid: [],
  failed: [],
  canceled: [],
};

const MAX_RETRY_COUNT = 1;

// ── Service Interface ────────────────────────────────────────────────────────

export interface PayoutService {
  // Payout accounts
  createPayoutAccount(input: PayoutAccountInput): Promise<Result<PayoutAccount, PayoutError>>;
  listPayoutAccounts(merchantAccountId?: string | undefined): Promise<Result<PayoutAccount[], PayoutError>>;
  getPayoutAccount(id: string): Promise<Result<PayoutAccount, PayoutError>>;
  verifyPayoutAccount(id: string): Promise<Result<PayoutAccount, PayoutError>>;
  disablePayoutAccount(id: string): Promise<Result<PayoutAccount, PayoutError>>;
  setDefaultPayoutAccount(id: string): Promise<Result<PayoutAccount, PayoutError>>;

  // Payouts
  schedulePayout(input: SchedulePayoutInput): Promise<Result<Payout, PayoutError>>;
  processPayout(id: string): Promise<Result<Payout, PayoutError>>;
  cancelPayout(id: string): Promise<Result<Payout, PayoutError>>;
  getPayout(id: string): Promise<Result<Payout, PayoutError>>;
  listPayouts(filters?: PayoutFilters | undefined): Promise<Result<{ payouts: Payout[]; total: number }, PayoutError>>;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createPayoutService(
  prisma: PrismaClient,
  tenantId: string,
  ledgerService: LedgerService,
  eventStore: EventStore,
  webhookService: WebhookDeliveryService,
): PayoutService {

  function toPayoutAccount(record: {
    id: string;
    tenantId: string;
    merchantAccountId: string;
    type: string;
    bankName: string;
    accountNumberMasked: string;
    routingNumber: string;
    currency: string;
    country: string;
    status: string;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): PayoutAccount {
    return {
      id: record.id,
      tenantId: record.tenantId,
      merchantAccountId: record.merchantAccountId,
      type: record.type as PayoutAccountType,
      bankName: record.bankName,
      accountNumberMasked: record.accountNumberMasked,
      routingNumber: record.routingNumber,
      currency: record.currency,
      country: record.country,
      status: record.status as PayoutAccountStatus,
      isDefault: record.isDefault,
      createdAt: record.createdAt.toISOString(),
    };
  }

  function toPayout(record: {
    id: string;
    tenantId: string;
    merchantAccountId: string;
    payoutAccountId: string;
    amount: number;
    currency: string;
    fees: number;
    status: string;
    scheduledAt: Date | null;
    initiatedAt: Date | null;
    arrivedAt: Date | null;
    failedAt: Date | null;
    failureReason: string | null;
    retryCount: number;
    settlementIds: unknown;
    ledgerTransactionId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): Payout {
    return {
      id: record.id,
      tenantId: record.tenantId,
      merchantAccountId: record.merchantAccountId,
      payoutAccountId: record.payoutAccountId,
      amount: record.amount,
      currency: record.currency,
      fees: record.fees,
      status: record.status as PayoutStatus,
      scheduledAt: record.scheduledAt?.toISOString() ?? null,
      initiatedAt: record.initiatedAt?.toISOString() ?? null,
      arrivedAt: record.arrivedAt?.toISOString() ?? null,
      failedAt: record.failedAt?.toISOString() ?? null,
      failureReason: record.failureReason,
      retryCount: record.retryCount,
      settlementIds: (record.settlementIds ?? []) as string[],
      ledgerTransactionId: record.ledgerTransactionId,
      createdAt: record.createdAt.toISOString(),
    };
  }

  async function getNextEventVersion(aggregateId: string): Promise<number> {
    const existing = await eventStore.getByAggregateId(aggregateId);
    if (!existing.ok) return 1;
    return existing.value.length + 1;
  }

  return {
    // ── Payout Account Methods ─────────────────────────────────────────────

    async createPayoutAccount(input) {
      if (!input.merchantAccountId) {
        return err(new PayoutError("merchantAccountId is required", "VALIDATION"));
      }
      if (!input.bankName) {
        return err(new PayoutError("bankName is required", "VALIDATION"));
      }
      if (!input.accountNumberLast4 || input.accountNumberLast4.length !== 4) {
        return err(new PayoutError("accountNumberLast4 must be exactly 4 characters", "VALIDATION"));
      }

      try {
        const id = uuid();
        const record = await prisma.payoutAccount.create({
          data: {
            id,
            tenantId,
            merchantAccountId: input.merchantAccountId,
            type: input.type ?? "bank_account",
            bankName: input.bankName,
            accountNumberMasked: `****${input.accountNumberLast4}`,
            routingNumber: input.routingNumber ? `****${input.routingNumber.slice(-4)}` : "",
            currency: input.currency ?? "USD",
            country: input.country ?? "US",
            status: "pending_verification",
            isDefault: false,
          },
        });
        return ok(toPayoutAccount(record));
      } catch (error) {
        return err(new PayoutError(
          `Failed to create payout account: ${error instanceof Error ? error.message : String(error)}`,
          "PAYOUT_FAILURE",
        ));
      }
    },

    async listPayoutAccounts(merchantAccountId) {
      try {
        const where: { tenantId: string; merchantAccountId?: string } = { tenantId };
        if (merchantAccountId) where.merchantAccountId = merchantAccountId;

        const accounts = await prisma.payoutAccount.findMany({
          where,
          orderBy: { createdAt: "desc" },
        });
        return ok(accounts.map(toPayoutAccount));
      } catch (error) {
        return err(new PayoutError(
          `Failed to list payout accounts: ${error instanceof Error ? error.message : String(error)}`,
          "PAYOUT_FAILURE",
        ));
      }
    },

    async getPayoutAccount(id) {
      try {
        const record = await prisma.payoutAccount.findFirst({
          where: { tenantId, id },
        });
        if (!record) return err(new PayoutError(`Payout account ${id} not found`, "NOT_FOUND"));
        return ok(toPayoutAccount(record));
      } catch (error) {
        return err(new PayoutError(
          `Failed to get payout account: ${error instanceof Error ? error.message : String(error)}`,
          "PAYOUT_FAILURE",
        ));
      }
    },

    async verifyPayoutAccount(id) {
      try {
        const record = await prisma.payoutAccount.findFirst({
          where: { tenantId, id },
        });
        if (!record) return err(new PayoutError(`Payout account ${id} not found`, "NOT_FOUND"));
        if (record.status !== "pending_verification") {
          return err(new PayoutError(`Account is ${record.status}, cannot verify`, "INVALID_STATUS"));
        }

        const updated = await prisma.payoutAccount.update({
          where: { id },
          data: { status: "verified" },
        });
        return ok(toPayoutAccount(updated));
      } catch (error) {
        return err(new PayoutError(
          `Failed to verify payout account: ${error instanceof Error ? error.message : String(error)}`,
          "PAYOUT_FAILURE",
        ));
      }
    },

    async disablePayoutAccount(id) {
      try {
        const record = await prisma.payoutAccount.findFirst({
          where: { tenantId, id },
        });
        if (!record) return err(new PayoutError(`Payout account ${id} not found`, "NOT_FOUND"));
        if (record.status === "disabled") {
          return err(new PayoutError("Account is already disabled", "INVALID_STATUS"));
        }

        const updated = await prisma.payoutAccount.update({
          where: { id },
          data: { status: "disabled", isDefault: false },
        });
        return ok(toPayoutAccount(updated));
      } catch (error) {
        return err(new PayoutError(
          `Failed to disable payout account: ${error instanceof Error ? error.message : String(error)}`,
          "PAYOUT_FAILURE",
        ));
      }
    },

    async setDefaultPayoutAccount(id) {
      try {
        const record = await prisma.payoutAccount.findFirst({
          where: { tenantId, id },
        });
        if (!record) return err(new PayoutError(`Payout account ${id} not found`, "NOT_FOUND"));
        if (record.status !== "verified") {
          return err(new PayoutError("Only verified accounts can be set as default", "INVALID_STATUS"));
        }

        // Unset any existing default for the same merchant
        await prisma.payoutAccount.updateMany({
          where: { tenantId, merchantAccountId: record.merchantAccountId, isDefault: true },
          data: { isDefault: false },
        });

        const updated = await prisma.payoutAccount.update({
          where: { id },
          data: { isDefault: true },
        });
        return ok(toPayoutAccount(updated));
      } catch (error) {
        return err(new PayoutError(
          `Failed to set default payout account: ${error instanceof Error ? error.message : String(error)}`,
          "PAYOUT_FAILURE",
        ));
      }
    },

    // ── Payout Methods ──────────────────────────────────────────────────────

    async schedulePayout(input) {
      if (!input.merchantAccountId) {
        return err(new PayoutError("merchantAccountId is required", "VALIDATION"));
      }
      if (!Number.isInteger(input.amount) || input.amount <= 0) {
        return err(new PayoutError("amount must be a positive integer (cents)", "VALIDATION"));
      }

      // Resolve payout account: use provided or find default
      let payoutAccountId = input.payoutAccountId;
      if (!payoutAccountId) {
        const defaultAccount = await prisma.payoutAccount.findFirst({
          where: { tenantId, merchantAccountId: input.merchantAccountId, isDefault: true, status: "verified" },
        });
        if (!defaultAccount) {
          return err(new PayoutError("No verified default payout account found for this merchant", "NOT_FOUND"));
        }
        payoutAccountId = defaultAccount.id;
      } else {
        const account = await prisma.payoutAccount.findFirst({
          where: { tenantId, id: payoutAccountId },
        });
        if (!account) return err(new PayoutError(`Payout account ${payoutAccountId} not found`, "NOT_FOUND"));
        if (account.status !== "verified") {
          return err(new PayoutError("Payout account must be verified", "INVALID_STATUS"));
        }
      }

      try {
        const id = uuid();
        const now = new Date();
        const record = await prisma.payout.create({
          data: {
            id,
            tenantId,
            merchantAccountId: input.merchantAccountId,
            payoutAccountId,
            amount: input.amount,
            currency: input.currency ?? "USD",
            fees: 0,
            status: "pending",
            scheduledAt: now,
            settlementIds: input.settlementIds ?? [],
          },
        });

        const version = await getNextEventVersion(id);
        await eventStore.append({
          aggregateId: id,
          aggregateType: "Payout",
          eventType: "PayoutScheduled",
          version,
          payload: { payoutId: id, amount: input.amount, merchantAccountId: input.merchantAccountId },
          metadata: {},
        });

        await webhookService.dispatch("payout.scheduled", {
          payoutId: id,
          amount: input.amount,
          merchantAccountId: input.merchantAccountId,
        });

        return ok(toPayout(record));
      } catch (error) {
        return err(new PayoutError(
          `Failed to schedule payout: ${error instanceof Error ? error.message : String(error)}`,
          "PAYOUT_FAILURE",
        ));
      }
    },

    async processPayout(id) {
      try {
        const record = await prisma.payout.findFirst({
          where: { tenantId, id },
        });
        if (!record) return err(new PayoutError(`Payout ${id} not found`, "NOT_FOUND"));

        const currentStatus = record.status as PayoutStatus;
        const allowed = VALID_PAYOUT_TRANSITIONS[currentStatus];
        if (!allowed.includes("processing") && !allowed.includes("in_transit")) {
          return err(new PayoutError(
            `Cannot process payout in ${currentStatus} status`,
            "INVALID_STATUS",
          ));
        }

        // Post ledger entry: debit merchant_balance, credit merchant_payout
        const ledgerResult = await ledgerService.postTransactionByName(
          "settlement",
          `payout:${id}`,
          [
            { accountName: "merchant_balance", direction: "debit", amount: record.amount, currency: record.currency },
            { accountName: "merchant_payout", direction: "credit", amount: record.amount, currency: record.currency },
          ],
          `Payout ${id} to merchant ${record.merchantAccountId}`,
        );

        if (!ledgerResult.ok) {
          // On ledger failure, mark as failed
          const now = new Date();
          await prisma.payout.update({
            where: { id },
            data: { status: "failed", failedAt: now, failureReason: ledgerResult.error.message },
          });

          const version = await getNextEventVersion(id);
          await eventStore.append({
            aggregateId: id,
            aggregateType: "Payout",
            eventType: "PayoutFailed",
            version,
            payload: { payoutId: id, reason: ledgerResult.error.message },
            metadata: {},
          });
          await webhookService.dispatch("payout.failed", { payoutId: id, reason: ledgerResult.error.message });

          return err(new PayoutError(`Ledger posting failed: ${ledgerResult.error.message}`, "PAYOUT_FAILURE"));
        }

        // Simulate processing → in_transit (bank transfer initiated)
        const now = new Date();
        const updated = await prisma.payout.update({
          where: { id },
          data: {
            status: "in_transit",
            initiatedAt: now,
            ledgerTransactionId: ledgerResult.value.id,
          },
        });

        const version = await getNextEventVersion(id);
        await eventStore.append({
          aggregateId: id,
          aggregateType: "Payout",
          eventType: "PayoutInTransit",
          version,
          payload: { payoutId: id, ledgerTransactionId: ledgerResult.value.id },
          metadata: {},
        });

        await webhookService.dispatch("payout.in_transit", {
          payoutId: id,
          amount: record.amount,
        });

        return ok(toPayout(updated));
      } catch (error) {
        // Auto-retry once on unexpected failure
        const record = await prisma.payout.findFirst({ where: { tenantId, id } });
        if (record && record.retryCount < MAX_RETRY_COUNT) {
          await prisma.payout.update({
            where: { id },
            data: { retryCount: record.retryCount + 1 },
          });
        }

        return err(new PayoutError(
          `Failed to process payout: ${error instanceof Error ? error.message : String(error)}`,
          "PAYOUT_FAILURE",
        ));
      }
    },

    async cancelPayout(id) {
      try {
        const record = await prisma.payout.findFirst({
          where: { tenantId, id },
        });
        if (!record) return err(new PayoutError(`Payout ${id} not found`, "NOT_FOUND"));

        if (record.status !== "pending") {
          return err(new PayoutError(
            `Cannot cancel payout in ${record.status} status — only pending payouts can be canceled`,
            "INVALID_STATUS",
          ));
        }

        const updated = await prisma.payout.update({
          where: { id },
          data: { status: "canceled" },
        });

        const version = await getNextEventVersion(id);
        await eventStore.append({
          aggregateId: id,
          aggregateType: "Payout",
          eventType: "PayoutCanceled",
          version,
          payload: { payoutId: id },
          metadata: {},
        });

        await webhookService.dispatch("payout.canceled", { payoutId: id });

        return ok(toPayout(updated));
      } catch (error) {
        return err(new PayoutError(
          `Failed to cancel payout: ${error instanceof Error ? error.message : String(error)}`,
          "PAYOUT_FAILURE",
        ));
      }
    },

    async getPayout(id) {
      try {
        const record = await prisma.payout.findFirst({
          where: { tenantId, id },
        });
        if (!record) return err(new PayoutError(`Payout ${id} not found`, "NOT_FOUND"));
        return ok(toPayout(record));
      } catch (error) {
        return err(new PayoutError(
          `Failed to get payout: ${error instanceof Error ? error.message : String(error)}`,
          "PAYOUT_FAILURE",
        ));
      }
    },

    async listPayouts(filters) {
      try {
        const where: Record<string, unknown> = { tenantId };
        if (filters?.status) where.status = filters.status;
        if (filters?.merchantAccountId) where.merchantAccountId = filters.merchantAccountId;

        const [payouts, total] = await Promise.all([
          prisma.payout.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: filters?.limit ?? 50,
            skip: filters?.offset ?? 0,
          }),
          prisma.payout.count({ where }),
        ]);

        return ok({ payouts: payouts.map(toPayout), total });
      } catch (error) {
        return err(new PayoutError(
          `Failed to list payouts: ${error instanceof Error ? error.message : String(error)}`,
          "PAYOUT_FAILURE",
        ));
      }
    },
  };
}

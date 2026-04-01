import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";

/** Platform fee in basis points (3% = 300 bps). */
export const PLATFORM_FEE_BPS = 300;

export type AccountType = "asset" | "liability" | "revenue" | "expense";

export type TransactionType =
  | "payment_captured"
  | "refund"
  | "settlement"
  | "fee"
  | "chargeback"
  | "adjustment";

export interface LedgerAccount {
  id: string;
  tenantId: string;
  type: AccountType;
  name: string;
  currency: string;
  isSystemAccount: boolean;
  createdAt: string;
}

export interface LedgerEntryInput {
  accountId: string;
  direction: "debit" | "credit";
  amount: number;
  currency: string;
  effectiveAt: Date;
  metadata?: Record<string, unknown> | undefined;
}

export interface LedgerEntry {
  id: string;
  tenantId: string;
  transactionId: string;
  accountId: string;
  direction: "debit" | "credit";
  amount: number;
  currency: string;
  effectiveAt: string;
  postedAt: string;
  metadata: Record<string, unknown>;
}

export interface LedgerTransaction {
  id: string;
  tenantId: string;
  type: TransactionType;
  idempotencyKey: string;
  status: "pending" | "posted" | "reversed";
  description: string;
  entries: LedgerEntry[];
  createdAt: string;
}

export interface AccountBalance {
  accountId: string;
  accountName: string;
  accountType: AccountType;
  currency: string;
  balance: number;
  asOf: string;
}

export interface ReconciliationResult {
  passed: boolean;
  totalDebits: number;
  totalCredits: number;
  discrepancy: number;
  orphanedEntries: number;
  invalidTransactions: number;
  checkedAt: string;
}

export class LedgerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "IMBALANCED"
      | "DUPLICATE"
      | "INVALID_ENTRY"
      | "NOT_FOUND"
      | "LEDGER_FAILURE",
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

export interface NamedEntryInput {
  accountName: string;
  direction: "debit" | "credit";
  amount: number;
  currency: string;
}

export interface LedgerService {
  ensureSystemAccounts(): Promise<Result<void, LedgerError>>;
  getAccount(name: string): Promise<Result<LedgerAccount, LedgerError>>;
  listAccounts(): Promise<Result<LedgerAccount[], LedgerError>>;
  postTransaction(
    type: TransactionType,
    idempotencyKey: string,
    entries: LedgerEntryInput[],
    description?: string | undefined,
  ): Promise<Result<LedgerTransaction, LedgerError>>;
  postTransactionByName(
    type: TransactionType,
    idempotencyKey: string,
    entries: NamedEntryInput[],
    description?: string | undefined,
  ): Promise<Result<LedgerTransaction, LedgerError>>;
  getBalance(accountId: string, asOf?: Date | undefined): Promise<Result<AccountBalance, LedgerError>>;
  getStatement(accountId: string, from: Date, to: Date): Promise<Result<LedgerEntry[], LedgerError>>;
  getTransaction(transactionId: string): Promise<Result<LedgerTransaction, LedgerError>>;
  listTransactions(limit: number, offset: number): Promise<Result<{ transactions: LedgerTransaction[]; total: number }, LedgerError>>;
  reconcile(): Promise<Result<ReconciliationResult, LedgerError>>;
  postPaymentCaptured(paymentId: string, amount: number, currency: string): Promise<Result<LedgerTransaction, LedgerError>>;
  postRefund(paymentId: string, amount: number, currency: string, refundFees?: boolean | undefined): Promise<Result<LedgerTransaction, LedgerError>>;
}

const SYSTEM_ACCOUNTS: Array<{ name: string; type: AccountType }> = [
  { name: "provider_settlement", type: "asset" },
  { name: "merchant_balance", type: "liability" },
  { name: "platform_fees", type: "revenue" },
  { name: "settled_payouts", type: "expense" },
  { name: "refund_reserve", type: "liability" },
  { name: "bad_debt", type: "expense" },
  { name: "subscription_adjustments", type: "revenue" },
  { name: "dispute_holds", type: "liability" },
  { name: "merchant_payout", type: "asset" },
];

export function createLedgerService(prisma: PrismaClient, tenantId: string): LedgerService {
  function toEntry(record: {
    id: string;
    tenantId: string;
    transactionId: string;
    accountId: string;
    direction: string;
    amount: number;
    currency: string;
    effectiveAt: Date;
    postedAt: Date;
    metadata: unknown;
    createdAt: Date;
  }): LedgerEntry {
    return {
      id: record.id,
      tenantId: record.tenantId,
      transactionId: record.transactionId,
      accountId: record.accountId,
      direction: record.direction as "debit" | "credit",
      amount: record.amount,
      currency: record.currency,
      effectiveAt: record.effectiveAt.toISOString(),
      postedAt: record.postedAt.toISOString(),
      metadata: (record.metadata ?? {}) as Record<string, unknown>,
    };
  }

  async function getAccountByName(name: string): Promise<Result<{ id: string; name: string; type: string; currency: string }, LedgerError>> {
    try {
      const account = await prisma.ledgerAccount.findUnique({
        where: { tenantId_name: { tenantId, name } },
      });
      if (!account) return err(new LedgerError(`Account not found: ${name}`, "NOT_FOUND"));
      return ok(account);
    } catch (error) {
      return err(new LedgerError(
        `Failed to find account: ${error instanceof Error ? error.message : String(error)}`,
        "LEDGER_FAILURE",
      ));
    }
  }

  return {
    async ensureSystemAccounts() {
      try {
        for (const acct of SYSTEM_ACCOUNTS) {
          await prisma.ledgerAccount.upsert({
            where: { tenantId_name: { tenantId, name: acct.name } },
            create: {
              id: uuid(),
              tenantId,
              type: acct.type,
              name: acct.name,
              currency: "USD",
              isSystemAccount: true,
            },
            update: {},
          });
        }
        return ok(undefined);
      } catch (error) {
        return err(new LedgerError(
          `Failed to create system accounts: ${error instanceof Error ? error.message : String(error)}`,
          "LEDGER_FAILURE",
        ));
      }
    },

    async getAccount(name) {
      try {
        const account = await prisma.ledgerAccount.findUnique({
          where: { tenantId_name: { tenantId, name } },
        });
        if (!account) return err(new LedgerError(`Account not found: ${name}`, "NOT_FOUND"));
        return ok({
          id: account.id,
          tenantId: account.tenantId,
          type: account.type as AccountType,
          name: account.name,
          currency: account.currency,
          isSystemAccount: account.isSystemAccount,
          createdAt: account.createdAt.toISOString(),
        });
      } catch (error) {
        return err(new LedgerError(
          `Failed to get account: ${error instanceof Error ? error.message : String(error)}`,
          "LEDGER_FAILURE",
        ));
      }
    },

    async listAccounts() {
      try {
        const accounts = await prisma.ledgerAccount.findMany({
          where: { tenantId },
          orderBy: { name: "asc" },
        });
        return ok(accounts.map((a) => ({
          id: a.id,
          tenantId: a.tenantId,
          type: a.type as AccountType,
          name: a.name,
          currency: a.currency,
          isSystemAccount: a.isSystemAccount,
          createdAt: a.createdAt.toISOString(),
        })));
      } catch (error) {
        return err(new LedgerError(
          `Failed to list accounts: ${error instanceof Error ? error.message : String(error)}`,
          "LEDGER_FAILURE",
        ));
      }
    },

    async postTransaction(type, idempotencyKey, entries, description) {
      // Validate double-entry invariant: sum of debits must equal sum of credits
      let debitTotal = 0;
      let creditTotal = 0;
      for (const entry of entries) {
        if (entry.amount <= 0) {
          return err(new LedgerError(`Entry amount must be positive, got ${entry.amount}`, "INVALID_ENTRY"));
        }
        if (entry.direction === "debit") debitTotal += entry.amount;
        else creditTotal += entry.amount;
      }

      if (debitTotal !== creditTotal) {
        return err(new LedgerError(
          `Double-entry violation: debits (${debitTotal}) !== credits (${creditTotal})`,
          "IMBALANCED",
        ));
      }

      if (entries.length < 2) {
        return err(new LedgerError("A transaction requires at least 2 entries", "INVALID_ENTRY"));
      }

      try {
        // Check idempotency — return existing if already posted
        const existing = await prisma.ledgerTransaction.findUnique({
          where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
        });

        if (existing) {
          const existingEntries = await prisma.ledgerEntry.findMany({
            where: { tenantId, transactionId: existing.id },
            orderBy: { createdAt: "asc" },
          });
          return ok({
            id: existing.id,
            tenantId: existing.tenantId,
            type: existing.type as TransactionType,
            idempotencyKey: existing.idempotencyKey,
            status: existing.status as "pending" | "posted" | "reversed",
            description: existing.description,
            entries: existingEntries.map(toEntry),
            createdAt: existing.createdAt.toISOString(),
          });
        }

        // Post atomically
        const txnId = uuid();
        const now = new Date();

        const [transaction] = await prisma.$transaction([
          prisma.ledgerTransaction.create({
            data: {
              id: txnId,
              tenantId,
              type,
              idempotencyKey,
              status: "posted",
              description: description ?? "",
            },
          }),
          ...entries.map((entry) =>
            prisma.ledgerEntry.create({
              data: {
                id: uuid(),
                tenantId,
                transactionId: txnId,
                accountId: entry.accountId,
                direction: entry.direction,
                amount: entry.amount,
                currency: entry.currency,
                effectiveAt: entry.effectiveAt,
                postedAt: now,
                metadata: (entry.metadata ?? {}) as import("@prisma/client").Prisma.InputJsonValue,
              },
            }),
          ),
        ]);

        const createdEntries = await prisma.ledgerEntry.findMany({
          where: { tenantId, transactionId: txnId },
          orderBy: { createdAt: "asc" },
        });

        return ok({
          id: transaction.id,
          tenantId: transaction.tenantId,
          type: transaction.type as TransactionType,
          idempotencyKey: transaction.idempotencyKey,
          status: transaction.status as "pending" | "posted" | "reversed",
          description: transaction.description,
          entries: createdEntries.map(toEntry),
          createdAt: transaction.createdAt.toISOString(),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("Unique constraint")) {
          return err(new LedgerError(`Duplicate transaction: ${idempotencyKey}`, "DUPLICATE"));
        }
        return err(new LedgerError(`Failed to post transaction: ${msg}`, "LEDGER_FAILURE"));
      }
    },

    async getBalance(accountId, asOf) {
      try {
        const account = await prisma.ledgerAccount.findFirst({
          where: { tenantId, id: accountId },
        });
        if (!account) return err(new LedgerError(`Account not found: ${accountId}`, "NOT_FOUND"));

        const dateFilter = asOf ? { lte: asOf } : undefined;

        const entries = await prisma.ledgerEntry.findMany({
          where: {
            tenantId,
            accountId,
            ...(dateFilter ? { effectiveAt: dateFilter } : {}),
          },
        });

        let balance = 0;
        for (const entry of entries) {
          if (entry.direction === "debit") balance += entry.amount;
          else balance -= entry.amount;
        }

        // For liability and revenue accounts, the natural balance is credit-positive.
        // Negate so that a positive balance means "money owed" or "revenue earned".
        if (account.type === "liability" || account.type === "revenue") {
          balance = -balance;
        }

        return ok({
          accountId: account.id,
          accountName: account.name,
          accountType: account.type as AccountType,
          currency: account.currency,
          balance,
          asOf: (asOf ?? new Date()).toISOString(),
        });
      } catch (error) {
        return err(new LedgerError(
          `Failed to compute balance: ${error instanceof Error ? error.message : String(error)}`,
          "LEDGER_FAILURE",
        ));
      }
    },

    async getStatement(accountId, from, to) {
      try {
        const account = await prisma.ledgerAccount.findFirst({
          where: { tenantId, id: accountId },
        });
        if (!account) return err(new LedgerError(`Account not found: ${accountId}`, "NOT_FOUND"));

        const entries = await prisma.ledgerEntry.findMany({
          where: {
            tenantId,
            accountId,
            effectiveAt: { gte: from, lte: to },
          },
          orderBy: { effectiveAt: "asc" },
        });

        return ok(entries.map(toEntry));
      } catch (error) {
        return err(new LedgerError(
          `Failed to get statement: ${error instanceof Error ? error.message : String(error)}`,
          "LEDGER_FAILURE",
        ));
      }
    },

    async getTransaction(transactionId) {
      try {
        const txn = await prisma.ledgerTransaction.findFirst({
          where: { tenantId, id: transactionId },
        });
        if (!txn) return err(new LedgerError(`Transaction not found: ${transactionId}`, "NOT_FOUND"));

        const entries = await prisma.ledgerEntry.findMany({
          where: { tenantId, transactionId },
          orderBy: { createdAt: "asc" },
        });

        return ok({
          id: txn.id,
          tenantId: txn.tenantId,
          type: txn.type as TransactionType,
          idempotencyKey: txn.idempotencyKey,
          status: txn.status as "pending" | "posted" | "reversed",
          description: txn.description,
          entries: entries.map(toEntry),
          createdAt: txn.createdAt.toISOString(),
        });
      } catch (error) {
        return err(new LedgerError(
          `Failed to get transaction: ${error instanceof Error ? error.message : String(error)}`,
          "LEDGER_FAILURE",
        ));
      }
    },

    async listTransactions(limit, offset) {
      try {
        const [transactions, total] = await Promise.all([
          prisma.ledgerTransaction.findMany({
            where: { tenantId },
            orderBy: { createdAt: "desc" },
            take: limit,
            skip: offset,
          }),
          prisma.ledgerTransaction.count({ where: { tenantId } }),
        ]);

        const result: LedgerTransaction[] = [];
        for (const txn of transactions) {
          const entries = await prisma.ledgerEntry.findMany({
            where: { tenantId, transactionId: txn.id },
            orderBy: { createdAt: "asc" },
          });
          result.push({
            id: txn.id,
            tenantId: txn.tenantId,
            type: txn.type as TransactionType,
            idempotencyKey: txn.idempotencyKey,
            status: txn.status as "pending" | "posted" | "reversed",
            description: txn.description,
            entries: entries.map(toEntry),
            createdAt: txn.createdAt.toISOString(),
          });
        }

        return ok({ transactions: result, total });
      } catch (error) {
        return err(new LedgerError(
          `Failed to list transactions: ${error instanceof Error ? error.message : String(error)}`,
          "LEDGER_FAILURE",
        ));
      }
    },

    async reconcile() {
      try {
        const allEntries = await prisma.ledgerEntry.findMany({
          where: { tenantId },
        });

        let totalDebits = 0;
        let totalCredits = 0;
        for (const entry of allEntries) {
          if (entry.direction === "debit") totalDebits += entry.amount;
          else totalCredits += entry.amount;
        }

        // Check for orphaned entries (entries without a transaction)
        const transactionIds = new Set(allEntries.map((e) => e.transactionId));
        let orphanedEntries = 0;
        for (const txnId of transactionIds) {
          const txn = await prisma.ledgerTransaction.findFirst({
            where: { tenantId, id: txnId },
          });
          if (!txn) {
            const orphanCount = allEntries.filter((e) => e.transactionId === txnId).length;
            orphanedEntries += orphanCount;
          }
        }

        // Check each transaction has balanced entries
        let invalidTransactions = 0;
        const txnEntries = new Map<string, typeof allEntries>();
        for (const entry of allEntries) {
          const list = txnEntries.get(entry.transactionId) ?? [];
          list.push(entry);
          txnEntries.set(entry.transactionId, list);
        }

        for (const [, entries] of txnEntries) {
          let debits = 0;
          let credits = 0;
          for (const e of entries) {
            if (e.direction === "debit") debits += e.amount;
            else credits += e.amount;
          }
          if (debits !== credits) invalidTransactions++;
        }

        const discrepancy = totalDebits - totalCredits;
        const passed = discrepancy === 0 && orphanedEntries === 0 && invalidTransactions === 0;

        return ok({
          passed,
          totalDebits,
          totalCredits,
          discrepancy,
          orphanedEntries,
          invalidTransactions,
          checkedAt: new Date().toISOString(),
        });
      } catch (error) {
        return err(new LedgerError(
          `Reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
          "LEDGER_FAILURE",
        ));
      }
    },

    async postTransactionByName(type, idempotencyKey, namedEntries, description) {
      const resolvedEntries: LedgerEntryInput[] = [];
      const now = new Date();
      for (const ne of namedEntries) {
        const acct = await getAccountByName(ne.accountName);
        if (!acct.ok) return err(acct.error);
        resolvedEntries.push({
          accountId: acct.value.id,
          direction: ne.direction,
          amount: ne.amount,
          currency: ne.currency,
          effectiveAt: now,
        });
      }
      return this.postTransaction(type, idempotencyKey, resolvedEntries, description);
    },

    async postPaymentCaptured(paymentId, amount, currency) {
      const feeAmount = Math.round((amount * PLATFORM_FEE_BPS) / 10_000);
      const merchantAmount = amount - feeAmount;
      const now = new Date();

      const providerAcct = await getAccountByName("provider_settlement");
      if (!providerAcct.ok) return err(providerAcct.error);

      const merchantAcct = await getAccountByName("merchant_balance");
      if (!merchantAcct.ok) return err(merchantAcct.error);

      const feesAcct = await getAccountByName("platform_fees");
      if (!feesAcct.ok) return err(feesAcct.error);

      const entries: LedgerEntryInput[] = [
        {
          accountId: providerAcct.value.id,
          direction: "debit",
          amount,
          currency,
          effectiveAt: now,
          metadata: { paymentId, description: "Payment captured — PSP owes us" },
        },
        {
          accountId: merchantAcct.value.id,
          direction: "credit",
          amount: merchantAmount,
          currency,
          effectiveAt: now,
          metadata: { paymentId, description: "Merchant payout accrued" },
        },
        {
          accountId: feesAcct.value.id,
          direction: "credit",
          amount: feeAmount,
          currency,
          effectiveAt: now,
          metadata: { paymentId, description: "Platform fee" },
        },
      ];

      return this.postTransaction(
        "payment_captured",
        `payment_captured:${paymentId}`,
        entries,
        `Payment ${paymentId} captured: ${amount} ${currency}`,
      );
    },

    async postRefund(paymentId, amount, currency, refundFees) {
      const shouldRefundFees = refundFees ?? true;
      const feeAmount = shouldRefundFees ? Math.round((amount * PLATFORM_FEE_BPS) / 10_000) : 0;
      const merchantAmount = amount - feeAmount;
      const now = new Date();

      const providerAcct = await getAccountByName("provider_settlement");
      if (!providerAcct.ok) return err(providerAcct.error);

      const merchantAcct = await getAccountByName("merchant_balance");
      if (!merchantAcct.ok) return err(merchantAcct.error);

      const entries: LedgerEntryInput[] = [
        {
          accountId: merchantAcct.value.id,
          direction: "debit",
          amount: merchantAmount,
          currency,
          effectiveAt: now,
          metadata: { paymentId, description: "Refund — reduce merchant balance" },
        },
        {
          accountId: providerAcct.value.id,
          direction: "credit",
          amount: merchantAmount,
          currency,
          effectiveAt: now,
          metadata: { paymentId, description: "Refund — reduce PSP receivable" },
        },
      ];

      if (shouldRefundFees && feeAmount > 0) {
        const feesAcct = await getAccountByName("platform_fees");
        if (!feesAcct.ok) return err(feesAcct.error);

        entries.push(
          {
            accountId: feesAcct.value.id,
            direction: "debit",
            amount: feeAmount,
            currency,
            effectiveAt: now,
            metadata: { paymentId, description: "Fee reversal on refund" },
          },
          {
            accountId: providerAcct.value.id,
            direction: "credit",
            amount: feeAmount,
            currency,
            effectiveAt: now,
            metadata: { paymentId, description: "Fee refund — reduce PSP receivable" },
          },
        );
      }

      return this.postTransaction(
        "refund",
        `refund:${paymentId}`,
        entries,
        `Refund for payment ${paymentId}: ${amount} ${currency}`,
      );
    },
  };
}

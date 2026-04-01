import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import type { LedgerService, LedgerEntry } from "../ledger/ledger-service.js";

export type SettlementStatus =
  | "calculating"
  | "pending_approval"
  | "approved"
  | "processing"
  | "settled"
  | "failed";

export type PayoutMethod = "bank_transfer" | "wallet";

export interface Settlement {
  id: string;
  tenantId: string;
  merchantAccountId: string;
  periodStart: string;
  periodEnd: string;
  status: SettlementStatus;
  grossAmount: number;
  totalFees: number;
  totalRefunds: number;
  totalChargebacks: number;
  netAmount: number;
  currency: string;
  payoutMethod: PayoutMethod;
  scheduledAt: string | null;
  settledAt: string | null;
  ledgerTransactionId: string | null;
  createdAt: string;
}

export interface SettlementLineItem {
  paymentId: string;
  type: "capture" | "refund" | "fee" | "chargeback";
  amount: number;
  currency: string;
  effectiveAt: string;
}

export interface SettlementReport {
  settlement: Settlement;
  lineItems: SettlementLineItem[];
  summary: {
    captureCount: number;
    refundCount: number;
    chargebackCount: number;
    grossAmount: number;
    totalFees: number;
    totalRefunds: number;
    totalChargebacks: number;
    netAmount: number;
  };
}

export class SettlementError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_STATUS"
      | "CALCULATION_FAILED"
      | "SETTLEMENT_FAILURE",
  ) {
    super(message);
    this.name = "SettlementError";
  }
}

export interface SettlementService {
  calculateSettlement(
    merchantAccountId: string,
    periodStart: Date,
    periodEnd: Date,
    currency?: string | undefined,
    payoutMethod?: PayoutMethod | undefined,
  ): Promise<Result<Settlement, SettlementError>>;
  getSettlement(id: string): Promise<Result<Settlement, SettlementError>>;
  listSettlements(limit: number, offset: number): Promise<Result<{ settlements: Settlement[]; total: number }, SettlementError>>;
  approveSettlement(id: string): Promise<Result<Settlement, SettlementError>>;
  processSettlement(id: string): Promise<Result<Settlement, SettlementError>>;
  generateReport(id: string): Promise<Result<SettlementReport, SettlementError>>;
  exportCsv(id: string): Promise<Result<string, SettlementError>>;
}

function toSettlement(record: {
  id: string;
  tenantId: string;
  merchantAccountId: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  grossAmount: number;
  totalFees: number;
  totalRefunds: number;
  totalChargebacks: number;
  netAmount: number;
  currency: string;
  payoutMethod: string;
  scheduledAt: Date | null;
  settledAt: Date | null;
  ledgerTransactionId: string | null;
  createdAt: Date;
}): Settlement {
  return {
    id: record.id,
    tenantId: record.tenantId,
    merchantAccountId: record.merchantAccountId,
    periodStart: record.periodStart.toISOString(),
    periodEnd: record.periodEnd.toISOString(),
    status: record.status as SettlementStatus,
    grossAmount: record.grossAmount,
    totalFees: record.totalFees,
    totalRefunds: record.totalRefunds,
    totalChargebacks: record.totalChargebacks,
    netAmount: record.netAmount,
    currency: record.currency,
    payoutMethod: record.payoutMethod as PayoutMethod,
    scheduledAt: record.scheduledAt?.toISOString() ?? null,
    settledAt: record.settledAt?.toISOString() ?? null,
    ledgerTransactionId: record.ledgerTransactionId,
    createdAt: record.createdAt.toISOString(),
  };
}

function buildLineItems(entries: LedgerEntry[], merchantAccountId: string): SettlementLineItem[] {
  const items: SettlementLineItem[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const meta = entry.metadata;
    const paymentId = typeof meta["paymentId"] === "string" ? meta["paymentId"] : `unknown_${entry.id}`;
    const description = typeof meta["description"] === "string" ? meta["description"] : "";

    // Deduplicate by using a compound key of paymentId + direction + description
    const key = `${paymentId}:${entry.direction}:${description}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Determine the line item type from the entry metadata/description
    let type: SettlementLineItem["type"] = "capture";
    if (description.toLowerCase().includes("refund")) type = "refund";
    else if (description.toLowerCase().includes("fee")) type = "fee";
    else if (description.toLowerCase().includes("chargeback")) type = "chargeback";
    else if (description.toLowerCase().includes("payout") || description.toLowerCase().includes("merchant")) type = "capture";

    items.push({
      paymentId,
      type,
      amount: entry.amount,
      currency: entry.currency,
      effectiveAt: entry.effectiveAt,
    });
  }

  // Suppress unused parameter warning — merchantAccountId used for scoping context
  void merchantAccountId;

  return items;
}

export function createSettlementService(
  prisma: PrismaClient,
  tenantId: string,
  ledgerService: LedgerService,
): SettlementService {
  return {
    async calculateSettlement(merchantAccountId, periodStart, periodEnd, currency, payoutMethod) {
      try {
        // Get the merchant_balance account to query entries
        const merchantAcct = await ledgerService.getAccount("merchant_balance");
        if (!merchantAcct.ok) {
          return err(new SettlementError(merchantAcct.error.message, "CALCULATION_FAILED"));
        }

        // Get all entries for the merchant_balance account in the period
        const statement = await ledgerService.getStatement(merchantAcct.value.id, periodStart, periodEnd);
        if (!statement.ok) {
          return err(new SettlementError(statement.error.message, "CALCULATION_FAILED"));
        }

        // Aggregate: credits are captures (money in), debits are refunds/settlements (money out)
        let grossAmount = 0;
        let totalRefunds = 0;
        let totalFees = 0;

        for (const entry of statement.value) {
          const desc = typeof entry.metadata["description"] === "string" ? entry.metadata["description"] : "";
          if (entry.direction === "credit") {
            grossAmount += entry.amount;
          } else if (entry.direction === "debit") {
            if (desc.toLowerCase().includes("refund")) {
              totalRefunds += entry.amount;
            }
          }
        }

        // Get fee entries from platform_fees account
        const feesAcct = await ledgerService.getAccount("platform_fees");
        if (feesAcct.ok) {
          const feeStatement = await ledgerService.getStatement(feesAcct.value.id, periodStart, periodEnd);
          if (feeStatement.ok) {
            for (const entry of feeStatement.value) {
              if (entry.direction === "credit") totalFees += entry.amount;
            }
          }
        }

        const netAmount = grossAmount - totalRefunds;

        const settlement = await prisma.settlement.create({
          data: {
            id: uuid(),
            tenantId,
            merchantAccountId,
            periodStart,
            periodEnd,
            status: "pending_approval",
            grossAmount,
            totalFees,
            totalRefunds,
            totalChargebacks: 0,
            netAmount,
            currency: currency ?? "USD",
            payoutMethod: payoutMethod ?? "bank_transfer",
          },
        });

        return ok(toSettlement(settlement));
      } catch (error) {
        return err(new SettlementError(
          `Failed to calculate settlement: ${error instanceof Error ? error.message : String(error)}`,
          "CALCULATION_FAILED",
        ));
      }
    },

    async getSettlement(id) {
      try {
        const record = await prisma.settlement.findFirst({
          where: { tenantId, id },
        });
        if (!record) return err(new SettlementError(`Settlement not found: ${id}`, "NOT_FOUND"));
        return ok(toSettlement(record));
      } catch (error) {
        return err(new SettlementError(
          `Failed to get settlement: ${error instanceof Error ? error.message : String(error)}`,
          "SETTLEMENT_FAILURE",
        ));
      }
    },

    async listSettlements(limit, offset) {
      try {
        const [records, total] = await Promise.all([
          prisma.settlement.findMany({
            where: { tenantId },
            orderBy: { createdAt: "desc" },
            take: limit,
            skip: offset,
          }),
          prisma.settlement.count({ where: { tenantId } }),
        ]);
        return ok({ settlements: records.map(toSettlement), total });
      } catch (error) {
        return err(new SettlementError(
          `Failed to list settlements: ${error instanceof Error ? error.message : String(error)}`,
          "SETTLEMENT_FAILURE",
        ));
      }
    },

    async approveSettlement(id) {
      try {
        const record = await prisma.settlement.findFirst({
          where: { tenantId, id },
        });
        if (!record) return err(new SettlementError(`Settlement not found: ${id}`, "NOT_FOUND"));
        if (record.status !== "pending_approval") {
          return err(new SettlementError(
            `Cannot approve settlement in status "${record.status}" — must be "pending_approval"`,
            "INVALID_STATUS",
          ));
        }

        const updated = await prisma.settlement.update({
          where: { id },
          data: { status: "approved" },
        });
        return ok(toSettlement(updated));
      } catch (error) {
        return err(new SettlementError(
          `Failed to approve settlement: ${error instanceof Error ? error.message : String(error)}`,
          "SETTLEMENT_FAILURE",
        ));
      }
    },

    async processSettlement(id) {
      try {
        const record = await prisma.settlement.findFirst({
          where: { tenantId, id },
        });
        if (!record) return err(new SettlementError(`Settlement not found: ${id}`, "NOT_FOUND"));
        if (record.status !== "approved") {
          return err(new SettlementError(
            `Cannot process settlement in status "${record.status}" — must be "approved"`,
            "INVALID_STATUS",
          ));
        }

        await prisma.settlement.update({
          where: { id },
          data: { status: "processing" },
        });

        // Create ledger entries: DEBIT merchant_balance, CREDIT settled_payouts
        const merchantAcct = await ledgerService.getAccount("merchant_balance");
        if (!merchantAcct.ok) {
          await prisma.settlement.update({ where: { id }, data: { status: "failed" } });
          return err(new SettlementError(merchantAcct.error.message, "SETTLEMENT_FAILURE"));
        }

        const payoutsAcct = await ledgerService.getAccount("settled_payouts");
        if (!payoutsAcct.ok) {
          await prisma.settlement.update({ where: { id }, data: { status: "failed" } });
          return err(new SettlementError(payoutsAcct.error.message, "SETTLEMENT_FAILURE"));
        }

        const ledgerResult = await ledgerService.postTransaction(
          "settlement",
          `settlement:${id}`,
          [
            {
              accountId: merchantAcct.value.id,
              direction: "debit",
              amount: record.netAmount,
              currency: record.currency,
              effectiveAt: new Date(),
              metadata: { settlementId: id, description: "Settlement payout" },
            },
            {
              accountId: payoutsAcct.value.id,
              direction: "credit",
              amount: record.netAmount,
              currency: record.currency,
              effectiveAt: new Date(),
              metadata: { settlementId: id, description: "Settlement payout" },
            },
          ],
          `Settlement ${id} — payout of ${record.netAmount} ${record.currency}`,
        );

        if (!ledgerResult.ok) {
          await prisma.settlement.update({ where: { id }, data: { status: "failed" } });
          return err(new SettlementError(ledgerResult.error.message, "SETTLEMENT_FAILURE"));
        }

        const settled = await prisma.settlement.update({
          where: { id },
          data: {
            status: "settled",
            settledAt: new Date(),
            ledgerTransactionId: ledgerResult.value.id,
          },
        });

        return ok(toSettlement(settled));
      } catch (error) {
        return err(new SettlementError(
          `Failed to process settlement: ${error instanceof Error ? error.message : String(error)}`,
          "SETTLEMENT_FAILURE",
        ));
      }
    },

    async generateReport(id) {
      try {
        const record = await prisma.settlement.findFirst({
          where: { tenantId, id },
        });
        if (!record) return err(new SettlementError(`Settlement not found: ${id}`, "NOT_FOUND"));

        const merchantAcct = await ledgerService.getAccount("merchant_balance");
        if (!merchantAcct.ok) {
          return err(new SettlementError(merchantAcct.error.message, "SETTLEMENT_FAILURE"));
        }

        const statement = await ledgerService.getStatement(
          merchantAcct.value.id,
          record.periodStart,
          record.periodEnd,
        );
        if (!statement.ok) {
          return err(new SettlementError(statement.error.message, "SETTLEMENT_FAILURE"));
        }

        const lineItems = buildLineItems(statement.value, record.merchantAccountId);
        const captureCount = lineItems.filter((l) => l.type === "capture").length;
        const refundCount = lineItems.filter((l) => l.type === "refund").length;
        const chargebackCount = lineItems.filter((l) => l.type === "chargeback").length;

        const settlement = toSettlement(record);

        return ok({
          settlement,
          lineItems,
          summary: {
            captureCount,
            refundCount,
            chargebackCount,
            grossAmount: settlement.grossAmount,
            totalFees: settlement.totalFees,
            totalRefunds: settlement.totalRefunds,
            totalChargebacks: settlement.totalChargebacks,
            netAmount: settlement.netAmount,
          },
        });
      } catch (error) {
        return err(new SettlementError(
          `Failed to generate report: ${error instanceof Error ? error.message : String(error)}`,
          "SETTLEMENT_FAILURE",
        ));
      }
    },

    async exportCsv(id) {
      const reportResult = await this.generateReport(id);
      if (!reportResult.ok) return err(reportResult.error);

      const { settlement, lineItems, summary } = reportResult.value;
      const lines: string[] = [];

      lines.push("Settlement Report");
      lines.push(`Settlement ID,${settlement.id}`);
      lines.push(`Period,${settlement.periodStart},${settlement.periodEnd}`);
      lines.push(`Status,${settlement.status}`);
      lines.push(`Currency,${settlement.currency}`);
      lines.push("");
      lines.push("Type,Payment ID,Amount,Currency,Date");

      for (const item of lineItems) {
        const amountFormatted = (item.amount / 100).toFixed(2);
        lines.push(`${item.type},${item.paymentId},${amountFormatted},${item.currency},${item.effectiveAt}`);
      }

      lines.push("");
      lines.push("Summary");
      lines.push(`Captures,${summary.captureCount},${(summary.grossAmount / 100).toFixed(2)}`);
      lines.push(`Refunds,${summary.refundCount},${(summary.totalRefunds / 100).toFixed(2)}`);
      lines.push(`Chargebacks,${summary.chargebackCount},${(summary.totalChargebacks / 100).toFixed(2)}`);
      lines.push(`Fees,,${(summary.totalFees / 100).toFixed(2)}`);
      lines.push(`Net Payout,,${(summary.netAmount / 100).toFixed(2)}`);

      return ok(lines.join("\n"));
    },
  };
}

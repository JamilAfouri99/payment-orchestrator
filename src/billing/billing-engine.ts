import { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import type { EventStore } from "../events/event-store.js";
import type { LedgerService } from "../ledger/ledger-service.js";
import { PLATFORM_FEE_BPS } from "../ledger/ledger-service.js";
import type { SubscriptionService, Subscription } from "../subscription/subscription-service.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type InvoiceStatus = "draft" | "open" | "paid" | "past_due" | "void" | "uncollectible";

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  periodStart: string;
  periodEnd: string;
}

export interface Invoice {
  id: string;
  tenantId: string;
  subscriptionId: string;
  customerId: string;
  status: InvoiceStatus;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxAmount: number;
  taxRate: number;
  total: number;
  currency: string;
  dueDate: Date;
  paidAt: Date | null;
  paymentId: string | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
  hostedInvoiceUrl: string;
  pdfUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillingCycleResult {
  processed: number;
  invoicesGenerated: number;
  paymentSuccesses: number;
  paymentFailures: number;
}

// ─── Error ──────────────────────────────────────────────────────────────────

export class BillingError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_STATUS"
      | "PAYMENT_FAILED"
      | "BILLING_FAILURE",
  ) {
    super(message);
    this.name = "BillingError";
  }
}

// ─── Service Interface ──────────────────────────────────────────────────────

export interface BillingEngine {
  processDueSubscriptions(): Promise<Result<BillingCycleResult, BillingError>>;
  generateInvoice(subscriptionId: string): Promise<Result<Invoice, BillingError>>;
  attemptPayment(invoiceId: string): Promise<Result<Invoice, BillingError>>;
  getInvoice(id: string): Promise<Result<Invoice, BillingError>>;
  listInvoices(filters?: { status?: InvoiceStatus | undefined; subscriptionId?: string | undefined }): Promise<Result<Invoice[], BillingError>>;
  voidInvoice(id: string): Promise<Result<Invoice, BillingError>>;
  markUncollectible(id: string): Promise<Result<Invoice, BillingError>>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toInvoice(row: Record<string, unknown>): Invoice {
  return {
    id: row["id"] as string,
    tenantId: row["tenantId"] as string,
    subscriptionId: row["subscriptionId"] as string,
    customerId: row["customerId"] as string,
    status: row["status"] as InvoiceStatus,
    lineItems: row["lineItems"] as InvoiceLineItem[],
    subtotal: row["subtotal"] as number,
    taxAmount: row["taxAmount"] as number,
    taxRate: row["taxRate"] as number,
    total: row["total"] as number,
    currency: row["currency"] as string,
    dueDate: row["dueDate"] as Date,
    paidAt: (row["paidAt"] as Date | null) ?? null,
    paymentId: (row["paymentId"] as string | null) ?? null,
    attemptCount: row["attemptCount"] as number,
    nextAttemptAt: (row["nextAttemptAt"] as Date | null) ?? null,
    hostedInvoiceUrl: row["hostedInvoiceUrl"] as string,
    pdfUrl: row["pdfUrl"] as string,
    createdAt: row["createdAt"] as Date,
    updatedAt: row["updatedAt"] as Date,
  };
}

function advancePeriod(from: Date, interval: string): Date {
  const d = new Date(from);
  switch (interval) {
    case "daily": d.setUTCDate(d.getUTCDate() + 1); break;
    case "weekly": d.setUTCDate(d.getUTCDate() + 7); break;
    case "monthly": d.setUTCMonth(d.getUTCMonth() + 1); break;
    case "yearly": d.setUTCFullYear(d.getUTCFullYear() + 1); break;
  }
  return d;
}

// ─── Invoice payment processor ──────────────────────────────────────────────

interface ProcessPaymentDeps {
  prisma: PrismaClient;
  ledgerService: LedgerService;
  subscriptionService: SubscriptionService;
  eventStore: EventStore;
}

async function processPaymentForInvoice(
  invoice: Invoice,
  deps: ProcessPaymentDeps,
): Promise<Result<Invoice, BillingError>> {
  const { prisma, ledgerService, subscriptionService, eventStore } = deps;
  try {
    // Simulate payment attempt — 85% success rate
    const paymentSucceeded = Math.random() < 0.85;
    const newAttemptCount = invoice.attemptCount + 1;
    const paymentId = paymentSucceeded ? `pay_${uuid()}` : null;

    await eventStore.append({
      aggregateId: invoice.subscriptionId,
      aggregateType: "Subscription",
      eventType: "InvoicePaymentAttempted" as import("../core/types.js").PaymentEventType,
      version: Date.now(),
      payload: {
        invoiceId: invoice.id,
        attemptCount: newAttemptCount,
        succeeded: paymentSucceeded,
        paymentId,
      },
      metadata: {},
    });

    if (paymentSucceeded) {
      const updated = await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "paid",
          paidAt: new Date(),
          paymentId,
          attemptCount: newAttemptCount,
          nextAttemptAt: null,
        },
      });

      // Post ledger entries for the payment
      const platformFee = Math.round((invoice.total * PLATFORM_FEE_BPS) / 10_000);
      const merchantAmount = invoice.total - platformFee;

      await ledgerService.postTransactionByName(
        "payment_captured",
        `invoice_payment:${invoice.id}`,
        [
          { accountName: "provider_settlement", direction: "debit" as const, amount: invoice.total, currency: invoice.currency },
          { accountName: "merchant_balance", direction: "credit" as const, amount: merchantAmount, currency: invoice.currency },
          { accountName: "platform_fees", direction: "credit" as const, amount: platformFee, currency: invoice.currency },
        ],
        `Invoice ${invoice.id} payment`,
      );

      await eventStore.append({
        aggregateId: invoice.subscriptionId,
        aggregateType: "Subscription",
        eventType: "InvoicePaid" as import("../core/types.js").PaymentEventType,
        version: Date.now(),
        payload: {
          invoiceId: invoice.id,
          paymentId,
          total: invoice.total,
        },
        metadata: {},
      });

      // Advance subscription billing period
      const subResult = await subscriptionService.get(invoice.subscriptionId);
      if (subResult.ok) {
        const sub = subResult.value;
        const planResult = await prisma.plan.findUnique({ where: { id: sub.planId } });
        if (planResult) {
          const newPeriodStart = sub.currentPeriodEnd;
          const newPeriodEnd = advancePeriod(newPeriodStart, planResult.billingInterval);

          // Apply pending downgrade if scheduled
          const meta = (sub.metadata ?? {}) as Record<string, unknown>;
          const pendingDowngrade = meta["pendingDowngrade"] as string | undefined;
          const updateData: Record<string, unknown> = {
            currentPeriodStart: newPeriodStart,
            currentPeriodEnd: newPeriodEnd,
            nextBillingDate: newPeriodEnd,
          };

          if (pendingDowngrade) {
            updateData["planId"] = pendingDowngrade;
            const cleanMeta = { ...meta };
            delete cleanMeta["pendingDowngrade"];
            delete cleanMeta["downgradeEffectiveAt"];
            updateData["metadata"] = cleanMeta as import("@prisma/client").Prisma.InputJsonValue;
          }

          await prisma.subscription.update({
            where: { id: sub.id },
            data: updateData,
          });
        }
      }

      // Re-activate subscription if it was past_due
      const currentSub = await subscriptionService.get(invoice.subscriptionId);
      if (currentSub.ok && currentSub.value.status === "past_due") {
        await subscriptionService.activate(invoice.subscriptionId);
      }

      return ok(toInvoice(updated as unknown as Record<string, unknown>));
    }

    // Payment failed
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "past_due",
        attemptCount: newAttemptCount,
      },
    });

    return err(new BillingError(
      `Payment failed for invoice ${invoice.id} (attempt ${newAttemptCount})`,
      "PAYMENT_FAILED",
    ));
  } catch (e) {
    return err(new BillingError(
      `Failed to process payment: ${e instanceof Error ? e.message : String(e)}`,
      "BILLING_FAILURE",
    ));
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createBillingEngine(
  prisma: PrismaClient,
  tenantId: string,
  subscriptionService: SubscriptionService,
  ledgerService: LedgerService,
  eventStore: EventStore,
): BillingEngine {
  const processDeps: ProcessPaymentDeps = { prisma, ledgerService, subscriptionService, eventStore };

  async function generateInvoiceForSubscription(sub: Subscription): Promise<Result<Invoice, BillingError>> {
    try {
      const planResult = await prisma.plan.findUnique({ where: { id: sub.planId } });
      if (!planResult) {
        return err(new BillingError(`Plan ${sub.planId} not found`, "NOT_FOUND"));
      }

      const periodStart = sub.currentPeriodEnd;
      const periodEnd = advancePeriod(periodStart, planResult.billingInterval);
      const lineAmount = planResult.amount * sub.quantity;

      const lineItems: InvoiceLineItem[] = [
        {
          description: `${planResult.name} (${planResult.billingInterval})${sub.quantity > 1 ? ` x${sub.quantity}` : ""}`,
          quantity: sub.quantity,
          unitAmount: planResult.amount,
          amount: lineAmount,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
        },
      ];

      const subtotal = lineAmount;
      const taxAmount = 0;
      const total = subtotal + taxAmount;
      const invoiceId = uuid();

      const row = await prisma.invoice.create({
        data: {
          id: invoiceId,
          tenantId,
          subscriptionId: sub.id,
          customerId: sub.customerId,
          status: "open",
          lineItems: lineItems as unknown as import("@prisma/client").Prisma.InputJsonValue,
          subtotal,
          taxAmount,
          taxRate: 0,
          total,
          currency: planResult.currency,
          dueDate: periodStart,
          hostedInvoiceUrl: `/invoices/${invoiceId}/view`,
          pdfUrl: `/invoices/${invoiceId}/pdf`,
        },
      });

      await eventStore.append({
        aggregateId: sub.id,
        aggregateType: "Subscription",
        eventType: "InvoiceGenerated" as import("../core/types.js").PaymentEventType,
        version: Date.now(),
        payload: {
          invoiceId,
          subscriptionId: sub.id,
          total,
          currency: planResult.currency,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
        },
        metadata: {},
      });

      return ok(toInvoice(row as unknown as Record<string, unknown>));
    } catch (e) {
      return err(new BillingError(
        `Failed to generate invoice: ${e instanceof Error ? e.message : String(e)}`,
        "BILLING_FAILURE",
      ));
    }
  }

  return {
    async processDueSubscriptions() {
      try {
        const now = new Date();
        const dueSubscriptions = await prisma.subscription.findMany({
          where: {
            tenantId,
            status: { in: ["active", "trialing"] },
            nextBillingDate: { lte: now },
          },
        });

        const result: BillingCycleResult = {
          processed: 0,
          invoicesGenerated: 0,
          paymentSuccesses: 0,
          paymentFailures: 0,
        };

        for (const row of dueSubscriptions) {
          const sub = {
            id: row.id,
            tenantId: row.tenantId,
            customerId: row.customerId,
            planId: row.planId,
            status: row.status as import("../subscription/subscription-service.js").SubscriptionStatus,
            currentPeriodStart: row.currentPeriodStart,
            currentPeriodEnd: row.currentPeriodEnd,
            trialStart: row.trialStart,
            trialEnd: row.trialEnd,
            canceledAt: row.canceledAt,
            cancelReason: row.cancelReason,
            paymentMethodTokenId: row.paymentMethodTokenId,
            nextBillingDate: row.nextBillingDate,
            quantity: row.quantity,
            metadata: row.metadata as Record<string, unknown>,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };

          result.processed++;

          // If trialing and trial is over, activate
          if (sub.status === "trialing" && sub.trialEnd && sub.trialEnd <= now) {
            await subscriptionService.activate(sub.id);
          }

          const invoiceResult = await generateInvoiceForSubscription(sub);
          if (!invoiceResult.ok) continue;

          result.invoicesGenerated++;

          const paymentResult = await processPaymentForInvoice(invoiceResult.value, processDeps);
          if (paymentResult.ok) {
            result.paymentSuccesses++;
          } else {
            result.paymentFailures++;
            // Mark subscription as past_due on first payment failure
            await subscriptionService.markPastDue(sub.id);
          }
        }

        return ok(result);
      } catch (e) {
        return err(new BillingError(
          `Billing cycle failed: ${e instanceof Error ? e.message : String(e)}`,
          "BILLING_FAILURE",
        ));
      }
    },

    async generateInvoice(subscriptionId) {
      const subResult = await subscriptionService.get(subscriptionId);
      if (!subResult.ok) {
        return err(new BillingError(`Subscription ${subscriptionId} not found`, "NOT_FOUND"));
      }
      return generateInvoiceForSubscription(subResult.value);
    },

    async attemptPayment(invoiceId) {
      const row = await prisma.invoice.findUnique({ where: { id: invoiceId } });
      if (!row || row.tenantId !== tenantId) {
        return err(new BillingError(`Invoice ${invoiceId} not found`, "NOT_FOUND"));
      }
      const invoice = toInvoice(row as unknown as Record<string, unknown>);

      if (invoice.status === "paid") {
        return err(new BillingError("Invoice already paid", "INVALID_STATUS"));
      }
      if (invoice.status === "void") {
        return err(new BillingError("Cannot pay a voided invoice", "INVALID_STATUS"));
      }

      return processPaymentForInvoice(invoice, processDeps);
    },

    async getInvoice(id) {
      try {
        const row = await prisma.invoice.findUnique({ where: { id } });
        if (!row || row.tenantId !== tenantId) {
          return err(new BillingError(`Invoice ${id} not found`, "NOT_FOUND"));
        }
        return ok(toInvoice(row as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new BillingError(
          `Failed to get invoice: ${e instanceof Error ? e.message : String(e)}`,
          "BILLING_FAILURE",
        ));
      }
    },

    async listInvoices(filters) {
      try {
        const where: Record<string, unknown> = { tenantId };
        if (filters?.status !== undefined) where["status"] = filters.status;
        if (filters?.subscriptionId !== undefined) where["subscriptionId"] = filters.subscriptionId;

        const rows = await prisma.invoice.findMany({
          where,
          orderBy: { createdAt: "desc" },
        });
        return ok(rows.map((r) => toInvoice(r as unknown as Record<string, unknown>)));
      } catch (e) {
        return err(new BillingError(
          `Failed to list invoices: ${e instanceof Error ? e.message : String(e)}`,
          "BILLING_FAILURE",
        ));
      }
    },

    async voidInvoice(id) {
      try {
        const row = await prisma.invoice.findUnique({ where: { id } });
        if (!row || row.tenantId !== tenantId) {
          return err(new BillingError(`Invoice ${id} not found`, "NOT_FOUND"));
        }
        if (row.status === "paid") {
          return err(new BillingError("Cannot void a paid invoice", "INVALID_STATUS"));
        }
        if (row.status === "void") {
          return err(new BillingError("Invoice already voided", "INVALID_STATUS"));
        }

        const updated = await prisma.invoice.update({
          where: { id },
          data: { status: "void", nextAttemptAt: null },
        });

        await eventStore.append({
          aggregateId: row.subscriptionId,
          aggregateType: "Subscription",
          eventType: "InvoiceVoided" as import("../core/types.js").PaymentEventType,
          version: Date.now(),
          payload: { invoiceId: id },
          metadata: {},
        });

        return ok(toInvoice(updated as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new BillingError(
          `Failed to void invoice: ${e instanceof Error ? e.message : String(e)}`,
          "BILLING_FAILURE",
        ));
      }
    },

    async markUncollectible(id) {
      try {
        const row = await prisma.invoice.findUnique({ where: { id } });
        if (!row || row.tenantId !== tenantId) {
          return err(new BillingError(`Invoice ${id} not found`, "NOT_FOUND"));
        }

        const updated = await prisma.invoice.update({
          where: { id },
          data: { status: "uncollectible", nextAttemptAt: null },
        });

        // Post write-off to ledger
        await ledgerService.postTransactionByName(
          "adjustment",
          `invoice_writeoff:${id}`,
          [
            { accountName: "bad_debt", direction: "debit" as const, amount: row.total, currency: row.currency },
            { accountName: "merchant_balance", direction: "credit" as const, amount: row.total, currency: row.currency },
          ],
          `Write-off for uncollectible invoice ${id}`,
        );

        await eventStore.append({
          aggregateId: row.subscriptionId,
          aggregateType: "Subscription",
          eventType: "InvoiceMarkedUncollectible" as import("../core/types.js").PaymentEventType,
          version: Date.now(),
          payload: { invoiceId: id, total: row.total },
          metadata: {},
        });

        return ok(toInvoice(updated as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new BillingError(
          `Failed to mark invoice uncollectible: ${e instanceof Error ? e.message : String(e)}`,
          "BILLING_FAILURE",
        ));
      }
    },
  };
}

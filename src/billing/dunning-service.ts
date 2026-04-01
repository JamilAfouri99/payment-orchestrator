import { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import type { EventStore } from "../events/event-store.js";
import type { BillingEngine } from "./billing-engine.js";
import type { SubscriptionService } from "../subscription/subscription-service.js";

// ─── Constants ──────────────────────────────────────────────────────────────

export const DEFAULT_MAX_RETRY_ATTEMPTS = 4;
export const DEFAULT_RETRY_SCHEDULE_DAYS = [1, 3, 5, 7];
export const DEFAULT_GRACE_PERIOD_DAYS = 7;

// ─── Types ──────────────────────────────────────────────────────────────────

export type DeclineType = "soft" | "hard";

export interface DunningConfig {
  id: string;
  tenantId: string;
  maxRetryAttempts: number;
  retryScheduleDays: number[];
  onFirstFailure: "email_customer" | "none";
  onEachRetry: "email_customer" | "none";
  onFinalFailure: "cancel_subscription" | "pause_subscription" | "mark_unpaid";
  gracePeriodDays: number;
}

export interface DunningFlow {
  invoiceId: string;
  subscriptionId: string;
  customerId: string;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  invoiceTotal: number;
  currency: string;
  startedAt: Date;
  status: "active" | "recovered" | "exhausted";
}

export interface RetryAnalytics {
  totalAttempts: number;
  totalRecovered: number;
  recoveryRate: number;
  byHourOfDay: Array<{ hour: number; attempts: number; successes: number; rate: number }>;
  byDayOfWeek: Array<{ day: number; dayName: string; attempts: number; successes: number; rate: number }>;
}

// ─── Error ──────────────────────────────────────────────────────────────────

export class DunningError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "CONFIG_ERROR"
      | "DUNNING_FAILURE",
  ) {
    super(message);
    this.name = "DunningError";
  }
}

// ─── Service Interface ──────────────────────────────────────────────────────

export interface DunningService {
  getConfig(): Promise<Result<DunningConfig, DunningError>>;
  updateConfig(config: Partial<Omit<DunningConfig, "id" | "tenantId">>): Promise<Result<DunningConfig, DunningError>>;
  startDunning(invoiceId: string): Promise<Result<void, DunningError>>;
  processRetries(): Promise<Result<{ processed: number; recovered: number; failed: number }, DunningError>>;
  getActiveDunningFlows(): Promise<Result<DunningFlow[], DunningError>>;
  getRetryAnalytics(): Promise<Result<RetryAnalytics, DunningError>>;
  scheduleSmartRetry(invoiceId: string): Promise<Result<Date, DunningError>>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toDunningConfig(row: Record<string, unknown>): DunningConfig {
  return {
    id: row["id"] as string,
    tenantId: row["tenantId"] as string,
    maxRetryAttempts: row["maxRetryAttempts"] as number,
    retryScheduleDays: row["retryScheduleDays"] as number[],
    onFirstFailure: row["onFirstFailure"] as "email_customer" | "none",
    onEachRetry: row["onEachRetry"] as "email_customer" | "none",
    onFinalFailure: row["onFinalFailure"] as "cancel_subscription" | "pause_subscription" | "mark_unpaid",
    gracePeriodDays: row["gracePeriodDays"] as number,
  };
}

function classifyDecline(): DeclineType {
  // Simulate: 30% chance of hard decline (stolen card, fraud), 70% soft decline
  return Math.random() < 0.3 ? "hard" : "soft";
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ─── Factory ────────────────────────────────────────────────────────────────

export function createDunningService(
  prisma: PrismaClient,
  tenantId: string,
  billingEngine: BillingEngine,
  subscriptionService: SubscriptionService,
  eventStore: EventStore,
): DunningService {

  async function ensureConfig(): Promise<DunningConfig> {
    const existing = await prisma.dunningConfig.findUnique({ where: { tenantId } });
    if (existing) return toDunningConfig(existing as unknown as Record<string, unknown>);

    const created = await prisma.dunningConfig.create({
      data: {
        id: uuid(),
        tenantId,
        maxRetryAttempts: DEFAULT_MAX_RETRY_ATTEMPTS,
        retryScheduleDays: DEFAULT_RETRY_SCHEDULE_DAYS as unknown as import("@prisma/client").Prisma.InputJsonValue,
        onFirstFailure: "email_customer",
        onEachRetry: "email_customer",
        onFinalFailure: "cancel_subscription",
        gracePeriodDays: DEFAULT_GRACE_PERIOD_DAYS,
      },
    });
    return toDunningConfig(created as unknown as Record<string, unknown>);
  }

  return {
    async getConfig() {
      try {
        return ok(await ensureConfig());
      } catch (e) {
        return err(new DunningError(
          `Failed to get config: ${e instanceof Error ? e.message : String(e)}`,
          "CONFIG_ERROR",
        ));
      }
    },

    async updateConfig(updates) {
      try {
        await ensureConfig();
        const data: Record<string, unknown> = {};
        if (updates.maxRetryAttempts !== undefined) data["maxRetryAttempts"] = updates.maxRetryAttempts;
        if (updates.retryScheduleDays !== undefined) data["retryScheduleDays"] = updates.retryScheduleDays as unknown as import("@prisma/client").Prisma.InputJsonValue;
        if (updates.onFirstFailure !== undefined) data["onFirstFailure"] = updates.onFirstFailure;
        if (updates.onEachRetry !== undefined) data["onEachRetry"] = updates.onEachRetry;
        if (updates.onFinalFailure !== undefined) data["onFinalFailure"] = updates.onFinalFailure;
        if (updates.gracePeriodDays !== undefined) data["gracePeriodDays"] = updates.gracePeriodDays;

        const updated = await prisma.dunningConfig.update({
          where: { tenantId },
          data,
        });
        return ok(toDunningConfig(updated as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new DunningError(
          `Failed to update config: ${e instanceof Error ? e.message : String(e)}`,
          "CONFIG_ERROR",
        ));
      }
    },

    async startDunning(invoiceId) {
      try {
        const config = await ensureConfig();

        const invoiceRow = await prisma.invoice.findUnique({ where: { id: invoiceId } });
        if (!invoiceRow || invoiceRow.tenantId !== tenantId) {
          return err(new DunningError(`Invoice ${invoiceId} not found`, "NOT_FOUND"));
        }

        // Mark subscription as past_due
        await subscriptionService.markPastDue(invoiceRow.subscriptionId);

        // Schedule first retry
        const schedule = config.retryScheduleDays;
        const firstRetryDays = schedule[0] ?? 1;
        const nextAttemptAt = new Date(Date.now() + firstRetryDays * 86_400_000);

        await prisma.invoice.update({
          where: { id: invoiceId },
          data: {
            status: "past_due",
            nextAttemptAt,
          },
        });

        // Log dunning event
        await eventStore.append({
          aggregateId: invoiceRow.subscriptionId,
          aggregateType: "Subscription",
          eventType: "DunningStarted" as import("../core/types.js").PaymentEventType,
          version: Date.now(),
          payload: {
            invoiceId,
            subscriptionId: invoiceRow.subscriptionId,
            nextAttemptAt: nextAttemptAt.toISOString(),
            maxAttempts: config.maxRetryAttempts,
          },
          metadata: {},
        });

        // Simulate notification
        if (config.onFirstFailure === "email_customer") {
          await eventStore.append({
            aggregateId: invoiceRow.subscriptionId,
            aggregateType: "Subscription",
            eventType: "DunningRetryScheduled" as import("../core/types.js").PaymentEventType,
            version: Date.now(),
            payload: {
              invoiceId,
              action: "email_customer",
              message: `Payment failed for invoice ${invoiceId}. We will retry on ${nextAttemptAt.toISOString()}.`,
            },
            metadata: {},
          });
        }

        return ok(undefined);
      } catch (e) {
        return err(new DunningError(
          `Failed to start dunning: ${e instanceof Error ? e.message : String(e)}`,
          "DUNNING_FAILURE",
        ));
      }
    },

    async processRetries() {
      try {
        const config = await ensureConfig();
        const now = new Date();

        // Find invoices due for retry
        const dueInvoices = await prisma.invoice.findMany({
          where: {
            tenantId,
            status: "past_due",
            nextAttemptAt: { lte: now },
          },
        });

        const result = { processed: 0, recovered: 0, failed: 0 };

        for (const row of dueInvoices) {
          result.processed++;

          // Check for hard decline — stop retries immediately
          const declineType = classifyDecline();
          if (declineType === "hard") {
            await eventStore.append({
              aggregateId: row.subscriptionId,
              aggregateType: "Subscription",
              eventType: "DunningRetryAttempted" as import("../core/types.js").PaymentEventType,
              version: Date.now(),
              payload: {
                invoiceId: row.id,
                attemptCount: row.attemptCount,
                declineType: "hard",
                result: "stopped",
                reason: "Hard decline — card flagged",
              },
              metadata: {},
            });

            // Execute final failure action
            await executeFinalAction(config, row.id, row.subscriptionId);
            result.failed++;
            continue;
          }

          // Attempt payment
          const paymentResult = await billingEngine.attemptPayment(row.id);

          await eventStore.append({
            aggregateId: row.subscriptionId,
            aggregateType: "Subscription",
            eventType: "DunningRetryAttempted" as import("../core/types.js").PaymentEventType,
            version: Date.now(),
            payload: {
              invoiceId: row.id,
              attemptCount: row.attemptCount + 1,
              declineType: "soft",
              result: paymentResult.ok ? "recovered" : "failed",
            },
            metadata: {},
          });

          if (paymentResult.ok) {
            result.recovered++;

            await eventStore.append({
              aggregateId: row.subscriptionId,
              aggregateType: "Subscription",
              eventType: "DunningRecovered" as import("../core/types.js").PaymentEventType,
              version: Date.now(),
              payload: { invoiceId: row.id },
              metadata: {},
            });
            continue;
          }

          // Payment failed — check if max retries exhausted
          const currentAttempt = row.attemptCount + 1;
          if (currentAttempt >= config.maxRetryAttempts) {
            await eventStore.append({
              aggregateId: row.subscriptionId,
              aggregateType: "Subscription",
              eventType: "DunningExhausted" as import("../core/types.js").PaymentEventType,
              version: Date.now(),
              payload: {
                invoiceId: row.id,
                totalAttempts: currentAttempt,
                action: config.onFinalFailure,
              },
              metadata: {},
            });

            await executeFinalAction(config, row.id, row.subscriptionId);
            result.failed++;
          } else {
            // Schedule next retry using smart scheduling
            const scheduleIndex = Math.min(currentAttempt, config.retryScheduleDays.length - 1);
            const retryDays = config.retryScheduleDays[scheduleIndex] ?? 1;
            const nextAttemptAt = new Date(Date.now() + retryDays * 86_400_000);

            await prisma.invoice.update({
              where: { id: row.id },
              data: { nextAttemptAt },
            });

            if (config.onEachRetry === "email_customer") {
              await eventStore.append({
                aggregateId: row.subscriptionId,
                aggregateType: "Subscription",
                eventType: "DunningRetryScheduled" as import("../core/types.js").PaymentEventType,
                version: Date.now(),
                payload: {
                  invoiceId: row.id,
                  nextAttemptAt: nextAttemptAt.toISOString(),
                  action: "email_customer",
                },
                metadata: {},
              });
            }
            result.failed++;
          }
        }

        return ok(result);
      } catch (e) {
        return err(new DunningError(
          `Failed to process retries: ${e instanceof Error ? e.message : String(e)}`,
          "DUNNING_FAILURE",
        ));
      }
    },

    async getActiveDunningFlows() {
      try {
        const config = await ensureConfig();
        const invoices = await prisma.invoice.findMany({
          where: {
            tenantId,
            status: "past_due",
          },
          orderBy: { createdAt: "desc" },
        });

        const flows: DunningFlow[] = invoices.map((inv) => ({
          invoiceId: inv.id,
          subscriptionId: inv.subscriptionId,
          customerId: inv.customerId,
          attemptCount: inv.attemptCount,
          maxAttempts: config.maxRetryAttempts,
          nextRetryAt: inv.nextAttemptAt,
          invoiceTotal: inv.total,
          currency: inv.currency,
          startedAt: inv.createdAt,
          status: "active" as const,
        }));

        return ok(flows);
      } catch (e) {
        return err(new DunningError(
          `Failed to get dunning flows: ${e instanceof Error ? e.message : String(e)}`,
          "DUNNING_FAILURE",
        ));
      }
    },

    async getRetryAnalytics() {
      try {
        // Gather all invoice payment attempt events from event store
        const events = await prisma.eventStore.findMany({
          where: {
            tenantId,
            eventType: { in: ["DunningRetryAttempted", "InvoicePaymentAttempted"] },
          },
          orderBy: { createdAt: "desc" },
          take: 1000,
        });

        let totalAttempts = 0;
        let totalRecovered = 0;
        const hourBuckets = Array.from({ length: 24 }, (_, i) => ({ hour: i, attempts: 0, successes: 0, rate: 0 }));
        const dayBuckets = Array.from({ length: 7 }, (_, i) => ({
          day: i,
          dayName: DAY_NAMES[i]!,
          attempts: 0,
          successes: 0,
          rate: 0,
        }));

        for (const event of events) {
          const payload = event.payload as Record<string, unknown>;
          const createdAt = event.createdAt;
          const hour = createdAt.getUTCHours();
          const day = createdAt.getUTCDay();
          const succeeded = payload["result"] === "recovered" || payload["succeeded"] === true;

          totalAttempts++;
          hourBuckets[hour]!.attempts++;
          dayBuckets[day]!.attempts++;

          if (succeeded) {
            totalRecovered++;
            hourBuckets[hour]!.successes++;
            dayBuckets[day]!.successes++;
          }
        }

        // Calculate rates
        for (const bucket of hourBuckets) {
          bucket.rate = bucket.attempts > 0 ? Math.round((bucket.successes / bucket.attempts) * 100) : 0;
        }
        for (const bucket of dayBuckets) {
          bucket.rate = bucket.attempts > 0 ? Math.round((bucket.successes / bucket.attempts) * 100) : 0;
        }

        return ok({
          totalAttempts,
          totalRecovered,
          recoveryRate: totalAttempts > 0 ? Math.round((totalRecovered / totalAttempts) * 100) : 0,
          byHourOfDay: hourBuckets,
          byDayOfWeek: dayBuckets,
        });
      } catch (e) {
        return err(new DunningError(
          `Failed to get analytics: ${e instanceof Error ? e.message : String(e)}`,
          "DUNNING_FAILURE",
        ));
      }
    },

    async scheduleSmartRetry(invoiceId) {
      try {
        const analytics = await this.getRetryAnalytics();
        let bestHour = 10; // Default to 10 AM UTC

        if (analytics.ok && analytics.value.totalAttempts > 10) {
          // Find the hour with the highest success rate (minimum 3 attempts)
          const eligible = analytics.value.byHourOfDay.filter((b) => b.attempts >= 3);
          if (eligible.length > 0) {
            eligible.sort((a, b) => b.rate - a.rate);
            bestHour = eligible[0]!.hour;
          }
        }

        // Schedule retry at the optimal hour tomorrow (or later today if not yet passed)
        const now = new Date();
        const target = new Date(now);
        target.setUTCHours(bestHour, 0, 0, 0);
        if (target <= now) {
          target.setUTCDate(target.getUTCDate() + 1);
        }

        await prisma.invoice.update({
          where: { id: invoiceId },
          data: { nextAttemptAt: target },
        });

        return ok(target);
      } catch (e) {
        return err(new DunningError(
          `Failed to schedule smart retry: ${e instanceof Error ? e.message : String(e)}`,
          "DUNNING_FAILURE",
        ));
      }
    },
  };

  async function executeFinalAction(
    config: DunningConfig,
    invoiceId: string,
    subscriptionId: string,
  ): Promise<void> {
    switch (config.onFinalFailure) {
      case "cancel_subscription":
        await subscriptionService.cancel(subscriptionId, "Dunning exhausted — payment recovery failed", true);
        await billingEngine.markUncollectible(invoiceId);
        break;
      case "pause_subscription":
        await subscriptionService.pause(subscriptionId);
        break;
      case "mark_unpaid":
        await billingEngine.markUncollectible(invoiceId);
        break;
    }
  }
}

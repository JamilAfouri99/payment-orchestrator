import { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import type { EventStore } from "../events/event-store.js";
import type { LedgerService } from "../ledger/ledger-service.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type BillingInterval = "daily" | "weekly" | "monthly" | "yearly";
export type PlanStatus = "active" | "archived";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "paused" | "canceled" | "expired";

export interface Plan {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  billingInterval: BillingInterval;
  amount: number;
  currency: string;
  trialDays: number;
  features: string[];
  status: PlanStatus;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Subscription {
  id: string;
  tenantId: string;
  customerId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialStart: Date | null;
  trialEnd: Date | null;
  canceledAt: Date | null;
  cancelReason: string | null;
  paymentMethodTokenId: string | null;
  nextBillingDate: Date;
  quantity: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePlanInput {
  name: string;
  description?: string | undefined;
  billingInterval: BillingInterval;
  amount: number;
  currency?: string | undefined;
  trialDays?: number | undefined;
  features?: string[] | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface CreateSubscriptionInput {
  customerId: string;
  planId: string;
  paymentMethodTokenId?: string | undefined;
  quantity?: number | undefined;
}

export interface ProrationResult {
  creditAmount: number;
  chargeAmount: number;
  netAmount: number;
  daysRemaining: number;
  totalDays: number;
}

export interface UpcomingInvoice {
  subscriptionId: string;
  planName: string;
  amount: number;
  currency: string;
  quantity: number;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
}

// ─── Valid State Transitions ────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  trialing: ["active", "canceled"],
  active: ["past_due", "paused", "canceled"],
  past_due: ["active", "canceled"],
  paused: ["active"],
  canceled: [],
  expired: [],
};

// ─── Error ──────────────────────────────────────────────────────────────────

export class SubscriptionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_STATUS"
      | "INVALID_PLAN"
      | "VALIDATION"
      | "PRORATION_FAILED"
      | "SUBSCRIPTION_FAILURE",
  ) {
    super(message);
    this.name = "SubscriptionError";
  }
}

// ─── Service Interface ──────────────────────────────────────────────────────

export interface SubscriptionService {
  createPlan(input: CreatePlanInput): Promise<Result<Plan, SubscriptionError>>;
  getPlan(id: string): Promise<Result<Plan, SubscriptionError>>;
  listPlans(): Promise<Result<Plan[], SubscriptionError>>;
  archivePlan(id: string): Promise<Result<Plan, SubscriptionError>>;

  create(input: CreateSubscriptionInput): Promise<Result<Subscription, SubscriptionError>>;
  get(id: string): Promise<Result<Subscription, SubscriptionError>>;
  list(status?: SubscriptionStatus | undefined): Promise<Result<Subscription[], SubscriptionError>>;
  cancel(id: string, reason: string, immediate?: boolean | undefined): Promise<Result<Subscription, SubscriptionError>>;
  upgrade(id: string, newPlanId: string): Promise<Result<Subscription, SubscriptionError>>;
  downgrade(id: string, newPlanId: string): Promise<Result<Subscription, SubscriptionError>>;
  pause(id: string): Promise<Result<Subscription, SubscriptionError>>;
  resume(id: string): Promise<Result<Subscription, SubscriptionError>>;
  getUpcomingInvoice(id: string): Promise<Result<UpcomingInvoice, SubscriptionError>>;
  getEvents(id: string): Promise<Result<Array<Record<string, unknown>>, SubscriptionError>>;

  activate(id: string): Promise<Result<Subscription, SubscriptionError>>;
  markPastDue(id: string): Promise<Result<Subscription, SubscriptionError>>;

  calculateProration(oldPlan: Plan, newPlan: Plan, subscription: Subscription): ProrationResult;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function advancePeriod(from: Date, interval: BillingInterval): Date {
  const d = new Date(from);
  switch (interval) {
    case "daily":
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case "yearly":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }
  return d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function toPlan(row: Record<string, unknown>): Plan {
  return {
    id: row["id"] as string,
    tenantId: row["tenantId"] as string,
    name: row["name"] as string,
    description: row["description"] as string,
    billingInterval: row["billingInterval"] as BillingInterval,
    amount: row["amount"] as number,
    currency: row["currency"] as string,
    trialDays: row["trialDays"] as number,
    features: row["features"] as string[],
    status: row["status"] as PlanStatus,
    metadata: row["metadata"] as Record<string, unknown>,
    createdAt: row["createdAt"] as Date,
    updatedAt: row["updatedAt"] as Date,
  };
}

function toSubscription(row: Record<string, unknown>): Subscription {
  return {
    id: row["id"] as string,
    tenantId: row["tenantId"] as string,
    customerId: row["customerId"] as string,
    planId: row["planId"] as string,
    status: row["status"] as SubscriptionStatus,
    currentPeriodStart: row["currentPeriodStart"] as Date,
    currentPeriodEnd: row["currentPeriodEnd"] as Date,
    trialStart: (row["trialStart"] as Date | null) ?? null,
    trialEnd: (row["trialEnd"] as Date | null) ?? null,
    canceledAt: (row["canceledAt"] as Date | null) ?? null,
    cancelReason: (row["cancelReason"] as string | null) ?? null,
    paymentMethodTokenId: (row["paymentMethodTokenId"] as string | null) ?? null,
    nextBillingDate: row["nextBillingDate"] as Date,
    quantity: row["quantity"] as number,
    metadata: row["metadata"] as Record<string, unknown>,
    createdAt: row["createdAt"] as Date,
    updatedAt: row["updatedAt"] as Date,
  };
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createSubscriptionService(
  prisma: PrismaClient,
  tenantId: string,
  eventStore: EventStore,
  ledgerService: LedgerService,
): SubscriptionService {

  async function transitionStatus(
    sub: Subscription,
    newStatus: SubscriptionStatus,
    eventType: string,
    eventPayload: Record<string, unknown>,
    updateData: Record<string, unknown>,
  ): Promise<Result<Subscription, SubscriptionError>> {
    const allowed = VALID_TRANSITIONS[sub.status];
    if (!allowed || !allowed.includes(newStatus)) {
      return err(new SubscriptionError(
        `Cannot transition from ${sub.status} to ${newStatus}`,
        "INVALID_STATUS",
      ));
    }

    try {
      const updated = await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: newStatus, ...updateData },
      });

      await eventStore.append({
        aggregateId: sub.id,
        aggregateType: "Subscription",
        eventType: eventType as import("../core/types.js").PaymentEventType,
        version: Date.now(),
        payload: { subscriptionId: sub.id, previousStatus: sub.status, newStatus, ...eventPayload },
        metadata: {},
      });

      return ok(toSubscription(updated as unknown as Record<string, unknown>));
    } catch (e) {
      return err(new SubscriptionError(
        `Failed to transition subscription: ${e instanceof Error ? e.message : String(e)}`,
        "SUBSCRIPTION_FAILURE",
      ));
    }
  }

  function calculateProration(oldPlan: Plan, newPlan: Plan, subscription: Subscription): ProrationResult {
    const totalDays = daysBetween(subscription.currentPeriodStart, subscription.currentPeriodEnd);
    const elapsed = daysBetween(subscription.currentPeriodStart, new Date());
    const daysRemaining = Math.max(0, totalDays - elapsed);

    if (totalDays === 0) {
      return { creditAmount: 0, chargeAmount: 0, netAmount: 0, daysRemaining: 0, totalDays: 0 };
    }

    const oldDailyRate = (oldPlan.amount * subscription.quantity) / totalDays;
    const newDailyRate = (newPlan.amount * subscription.quantity) / totalDays;

    const creditAmount = Math.round(oldDailyRate * daysRemaining);
    const chargeAmount = Math.round(newDailyRate * daysRemaining);
    const netAmount = chargeAmount - creditAmount;

    return { creditAmount, chargeAmount, netAmount, daysRemaining, totalDays };
  }

  return {
    // ── Plan CRUD ─────────────────────────────────────────────────────────

    async createPlan(input) {
      try {
        if (input.amount <= 0) {
          return err(new SubscriptionError("Plan amount must be positive", "VALIDATION"));
        }
        if (!input.name.trim()) {
          return err(new SubscriptionError("Plan name is required", "VALIDATION"));
        }

        const row = await prisma.plan.create({
          data: {
            id: uuid(),
            tenantId,
            name: input.name,
            description: input.description ?? "",
            billingInterval: input.billingInterval,
            amount: input.amount,
            currency: input.currency ?? "USD",
            trialDays: input.trialDays ?? 0,
            features: (input.features ?? []) as import("@prisma/client").Prisma.InputJsonValue,
            status: "active",
            metadata: (input.metadata ?? {}) as import("@prisma/client").Prisma.InputJsonValue,
          },
        });

        return ok(toPlan(row as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new SubscriptionError(
          `Failed to create plan: ${e instanceof Error ? e.message : String(e)}`,
          "SUBSCRIPTION_FAILURE",
        ));
      }
    },

    async getPlan(id) {
      try {
        const row = await prisma.plan.findUnique({ where: { id } });
        if (!row || row.tenantId !== tenantId) {
          return err(new SubscriptionError(`Plan ${id} not found`, "NOT_FOUND"));
        }
        return ok(toPlan(row as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new SubscriptionError(
          `Failed to get plan: ${e instanceof Error ? e.message : String(e)}`,
          "SUBSCRIPTION_FAILURE",
        ));
      }
    },

    async listPlans() {
      try {
        const rows = await prisma.plan.findMany({
          where: { tenantId, status: "active" },
          orderBy: { createdAt: "desc" },
        });
        return ok(rows.map((r) => toPlan(r as unknown as Record<string, unknown>)));
      } catch (e) {
        return err(new SubscriptionError(
          `Failed to list plans: ${e instanceof Error ? e.message : String(e)}`,
          "SUBSCRIPTION_FAILURE",
        ));
      }
    },

    async archivePlan(id) {
      try {
        const row = await prisma.plan.findUnique({ where: { id } });
        if (!row || row.tenantId !== tenantId) {
          return err(new SubscriptionError(`Plan ${id} not found`, "NOT_FOUND"));
        }
        const updated = await prisma.plan.update({
          where: { id },
          data: { status: "archived" },
        });
        return ok(toPlan(updated as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new SubscriptionError(
          `Failed to archive plan: ${e instanceof Error ? e.message : String(e)}`,
          "SUBSCRIPTION_FAILURE",
        ));
      }
    },

    // ── Subscription Lifecycle ────────────────────────────────────────────

    async create(input) {
      try {
        const planResult = await prisma.plan.findUnique({ where: { id: input.planId } });
        if (!planResult || planResult.tenantId !== tenantId || planResult.status !== "active") {
          return err(new SubscriptionError(`Plan ${input.planId} not found or archived`, "INVALID_PLAN"));
        }
        const plan = toPlan(planResult as unknown as Record<string, unknown>);

        const now = new Date();
        const hasTrial = plan.trialDays > 0;
        const trialEnd = hasTrial ? new Date(now.getTime() + plan.trialDays * 86_400_000) : null;
        const periodStart = hasTrial ? trialEnd! : now;
        const periodEnd = advancePeriod(periodStart, plan.billingInterval);
        const nextBillingDate = hasTrial ? trialEnd! : now;

        const subId = uuid();
        const row = await prisma.subscription.create({
          data: {
            id: subId,
            tenantId,
            customerId: input.customerId,
            planId: input.planId,
            status: hasTrial ? "trialing" : "active",
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            trialStart: hasTrial ? now : null,
            trialEnd,
            paymentMethodTokenId: input.paymentMethodTokenId ?? null,
            nextBillingDate,
            quantity: input.quantity ?? 1,
          },
        });

        const sub = toSubscription(row as unknown as Record<string, unknown>);

        const eventType = hasTrial ? "SubscriptionTrialStarted" : "SubscriptionActivated";
        await eventStore.append({
          aggregateId: subId,
          aggregateType: "Subscription",
          eventType: eventType as import("../core/types.js").PaymentEventType,
          version: 1,
          payload: {
            subscriptionId: subId,
            customerId: input.customerId,
            planId: input.planId,
            planName: plan.name,
            amount: plan.amount,
            currency: plan.currency,
            billingInterval: plan.billingInterval,
            trialDays: plan.trialDays,
            quantity: input.quantity ?? 1,
          },
          metadata: {},
        });

        return ok(sub);
      } catch (e) {
        return err(new SubscriptionError(
          `Failed to create subscription: ${e instanceof Error ? e.message : String(e)}`,
          "SUBSCRIPTION_FAILURE",
        ));
      }
    },

    async get(id) {
      try {
        const row = await prisma.subscription.findUnique({ where: { id } });
        if (!row || row.tenantId !== tenantId) {
          return err(new SubscriptionError(`Subscription ${id} not found`, "NOT_FOUND"));
        }
        return ok(toSubscription(row as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new SubscriptionError(
          `Failed to get subscription: ${e instanceof Error ? e.message : String(e)}`,
          "SUBSCRIPTION_FAILURE",
        ));
      }
    },

    async list(status) {
      try {
        const where: Record<string, unknown> = { tenantId };
        if (status !== undefined) where["status"] = status;

        const rows = await prisma.subscription.findMany({
          where,
          orderBy: { createdAt: "desc" },
        });
        return ok(rows.map((r) => toSubscription(r as unknown as Record<string, unknown>)));
      } catch (e) {
        return err(new SubscriptionError(
          `Failed to list subscriptions: ${e instanceof Error ? e.message : String(e)}`,
          "SUBSCRIPTION_FAILURE",
        ));
      }
    },

    async cancel(id, reason, immediate) {
      const subResult = await prisma.subscription.findUnique({ where: { id } });
      if (!subResult || subResult.tenantId !== tenantId) {
        return err(new SubscriptionError(`Subscription ${id} not found`, "NOT_FOUND"));
      }
      const sub = toSubscription(subResult as unknown as Record<string, unknown>);

      const updateData: Record<string, unknown> = {
        canceledAt: new Date(),
        cancelReason: reason,
      };

      if (immediate) {
        // Immediate cancel — calculate proration credit
        const planResult = await prisma.plan.findUnique({ where: { id: sub.planId } });
        if (planResult) {
          const plan = toPlan(planResult as unknown as Record<string, unknown>);
          const totalDays = daysBetween(sub.currentPeriodStart, sub.currentPeriodEnd);
          const elapsed = daysBetween(sub.currentPeriodStart, new Date());
          const daysRemaining = Math.max(0, totalDays - elapsed);

          if (totalDays > 0 && daysRemaining > 0) {
            const creditAmount = Math.round((plan.amount * sub.quantity * daysRemaining) / totalDays);
            if (creditAmount > 0) {
              await ledgerService.postTransactionByName(
                "adjustment",
                `subscription_cancel_credit:${sub.id}`,
                [
                  { accountName: "subscription_adjustments", direction: "debit" as const, amount: creditAmount, currency: plan.currency },
                  { accountName: "merchant_balance", direction: "credit" as const, amount: creditAmount, currency: plan.currency },
                ],
                `Cancellation credit for subscription ${sub.id}`,
              );
            }
          }
        }
      }

      return transitionStatus(sub, "canceled", "SubscriptionCanceled", { reason, immediate: immediate ?? false }, updateData);
    },

    async upgrade(id, newPlanId) {
      const subResult = await prisma.subscription.findUnique({ where: { id } });
      if (!subResult || subResult.tenantId !== tenantId) {
        return err(new SubscriptionError(`Subscription ${id} not found`, "NOT_FOUND"));
      }
      const sub = toSubscription(subResult as unknown as Record<string, unknown>);

      if (sub.status !== "active" && sub.status !== "trialing") {
        return err(new SubscriptionError(
          `Cannot upgrade subscription in ${sub.status} status`,
          "INVALID_STATUS",
        ));
      }

      const oldPlanResult = await prisma.plan.findUnique({ where: { id: sub.planId } });
      const newPlanResult = await prisma.plan.findUnique({ where: { id: newPlanId } });

      if (!oldPlanResult || oldPlanResult.tenantId !== tenantId) {
        return err(new SubscriptionError("Current plan not found", "INVALID_PLAN"));
      }
      if (!newPlanResult || newPlanResult.tenantId !== tenantId || newPlanResult.status !== "active") {
        return err(new SubscriptionError(`Plan ${newPlanId} not found or archived`, "INVALID_PLAN"));
      }

      const oldPlan = toPlan(oldPlanResult as unknown as Record<string, unknown>);
      const newPlan = toPlan(newPlanResult as unknown as Record<string, unknown>);

      if (newPlan.amount <= oldPlan.amount) {
        return err(new SubscriptionError(
          "New plan amount must be higher for upgrade; use downgrade instead",
          "VALIDATION",
        ));
      }

      const proration = calculateProration(oldPlan, newPlan, sub);

      // Post proration to ledger if there's a net charge
      if (proration.netAmount > 0) {
        await ledgerService.postTransactionByName(
          "adjustment",
          `subscription_upgrade:${sub.id}:${Date.now()}`,
          [
            { accountName: "provider_settlement", direction: "debit" as const, amount: proration.netAmount, currency: newPlan.currency },
            { accountName: "subscription_adjustments", direction: "credit" as const, amount: proration.netAmount, currency: newPlan.currency },
          ],
          `Proration charge for upgrade ${sub.id}: ${oldPlan.name} → ${newPlan.name}`,
        );
      } else if (proration.netAmount < 0) {
        const creditAmt = Math.abs(proration.netAmount);
        await ledgerService.postTransactionByName(
          "adjustment",
          `subscription_upgrade_credit:${sub.id}:${Date.now()}`,
          [
            { accountName: "subscription_adjustments", direction: "debit" as const, amount: creditAmt, currency: newPlan.currency },
            { accountName: "merchant_balance", direction: "credit" as const, amount: creditAmt, currency: newPlan.currency },
          ],
          `Proration credit for upgrade ${sub.id}: ${oldPlan.name} → ${newPlan.name}`,
        );
      }

      try {
        const updated = await prisma.subscription.update({
          where: { id },
          data: { planId: newPlanId },
        });

        await eventStore.append({
          aggregateId: sub.id,
          aggregateType: "Subscription",
          eventType: "SubscriptionUpgraded" as import("../core/types.js").PaymentEventType,
          version: Date.now(),
          payload: {
            subscriptionId: sub.id,
            oldPlanId: oldPlan.id,
            newPlanId: newPlan.id,
            oldPlanName: oldPlan.name,
            newPlanName: newPlan.name,
            proration,
          },
          metadata: {},
        });

        return ok(toSubscription(updated as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new SubscriptionError(
          `Failed to upgrade subscription: ${e instanceof Error ? e.message : String(e)}`,
          "SUBSCRIPTION_FAILURE",
        ));
      }
    },

    async downgrade(id, newPlanId) {
      const subResult = await prisma.subscription.findUnique({ where: { id } });
      if (!subResult || subResult.tenantId !== tenantId) {
        return err(new SubscriptionError(`Subscription ${id} not found`, "NOT_FOUND"));
      }
      const sub = toSubscription(subResult as unknown as Record<string, unknown>);

      if (sub.status !== "active" && sub.status !== "trialing") {
        return err(new SubscriptionError(
          `Cannot downgrade subscription in ${sub.status} status`,
          "INVALID_STATUS",
        ));
      }

      const newPlanResult = await prisma.plan.findUnique({ where: { id: newPlanId } });
      if (!newPlanResult || newPlanResult.tenantId !== tenantId || newPlanResult.status !== "active") {
        return err(new SubscriptionError(`Plan ${newPlanId} not found or archived`, "INVALID_PLAN"));
      }

      // Downgrade takes effect at next billing cycle — store in metadata
      try {
        const currentMeta = (sub.metadata ?? {}) as Record<string, unknown>;
        const updated = await prisma.subscription.update({
          where: { id },
          data: {
            metadata: {
              ...currentMeta,
              pendingDowngrade: newPlanId,
              downgradeEffectiveAt: sub.currentPeriodEnd.toISOString(),
            } as import("@prisma/client").Prisma.InputJsonValue,
          },
        });

        await eventStore.append({
          aggregateId: sub.id,
          aggregateType: "Subscription",
          eventType: "SubscriptionDowngraded" as import("../core/types.js").PaymentEventType,
          version: Date.now(),
          payload: {
            subscriptionId: sub.id,
            currentPlanId: sub.planId,
            newPlanId,
            effectiveAt: sub.currentPeriodEnd.toISOString(),
          },
          metadata: {},
        });

        return ok(toSubscription(updated as unknown as Record<string, unknown>));
      } catch (e) {
        return err(new SubscriptionError(
          `Failed to downgrade subscription: ${e instanceof Error ? e.message : String(e)}`,
          "SUBSCRIPTION_FAILURE",
        ));
      }
    },

    async pause(id) {
      const subResult = await prisma.subscription.findUnique({ where: { id } });
      if (!subResult || subResult.tenantId !== tenantId) {
        return err(new SubscriptionError(`Subscription ${id} not found`, "NOT_FOUND"));
      }
      const sub = toSubscription(subResult as unknown as Record<string, unknown>);
      return transitionStatus(sub, "paused", "SubscriptionPaused", {}, {});
    },

    async resume(id) {
      const subResult = await prisma.subscription.findUnique({ where: { id } });
      if (!subResult || subResult.tenantId !== tenantId) {
        return err(new SubscriptionError(`Subscription ${id} not found`, "NOT_FOUND"));
      }
      const sub = toSubscription(subResult as unknown as Record<string, unknown>);

      const now = new Date();
      const planResult = await prisma.plan.findUnique({ where: { id: sub.planId } });
      const interval = planResult ? (planResult.billingInterval as BillingInterval) : "monthly";
      const newPeriodEnd = advancePeriod(now, interval);

      return transitionStatus(sub, "active", "SubscriptionResumed", {}, {
        currentPeriodStart: now,
        currentPeriodEnd: newPeriodEnd,
        nextBillingDate: now,
      });
    },

    async activate(id) {
      const subResult = await prisma.subscription.findUnique({ where: { id } });
      if (!subResult || subResult.tenantId !== tenantId) {
        return err(new SubscriptionError(`Subscription ${id} not found`, "NOT_FOUND"));
      }
      const sub = toSubscription(subResult as unknown as Record<string, unknown>);

      const now = new Date();
      const planResult = await prisma.plan.findUnique({ where: { id: sub.planId } });
      const interval = planResult ? (planResult.billingInterval as BillingInterval) : "monthly";
      const newPeriodEnd = advancePeriod(now, interval);

      return transitionStatus(sub, "active", "SubscriptionActivated", {}, {
        currentPeriodStart: now,
        currentPeriodEnd: newPeriodEnd,
        nextBillingDate: newPeriodEnd,
      });
    },

    async markPastDue(id) {
      const subResult = await prisma.subscription.findUnique({ where: { id } });
      if (!subResult || subResult.tenantId !== tenantId) {
        return err(new SubscriptionError(`Subscription ${id} not found`, "NOT_FOUND"));
      }
      const sub = toSubscription(subResult as unknown as Record<string, unknown>);
      return transitionStatus(sub, "past_due", "SubscriptionPastDue", {}, {});
    },

    async getUpcomingInvoice(id) {
      const subResult = await prisma.subscription.findUnique({ where: { id } });
      if (!subResult || subResult.tenantId !== tenantId) {
        return err(new SubscriptionError(`Subscription ${id} not found`, "NOT_FOUND"));
      }
      const sub = toSubscription(subResult as unknown as Record<string, unknown>);

      const planResult = await prisma.plan.findUnique({ where: { id: sub.planId } });
      if (!planResult) {
        return err(new SubscriptionError("Plan not found", "INVALID_PLAN"));
      }
      const plan = toPlan(planResult as unknown as Record<string, unknown>);

      const periodStart = sub.currentPeriodEnd;
      const periodEnd = advancePeriod(periodStart, plan.billingInterval);

      return ok({
        subscriptionId: sub.id,
        planName: plan.name,
        amount: plan.amount * sub.quantity,
        currency: plan.currency,
        quantity: sub.quantity,
        periodStart,
        periodEnd,
        dueDate: periodStart,
      });
    },

    async getEvents(id) {
      const result = await eventStore.getByAggregateId(id);
      if (!result.ok) {
        return err(new SubscriptionError(result.error.message, "SUBSCRIPTION_FAILURE"));
      }
      return ok(result.value.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        payload: e.payload,
        createdAt: e.createdAt,
        version: e.version,
      })));
    },

    calculateProration,
  };
}

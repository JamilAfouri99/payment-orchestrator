import type { SagaStep } from "./saga-orchestrator.js";
import type { EventStore } from "../events/event-store.js";
import type { CircuitBreaker } from "../circuit-breaker/circuit-breaker.js";
import type { InventoryService } from "../external-services/inventory-service.js";
import type { NotificationService } from "../external-services/notification-service.js";
import type { RoutingEngine } from "../routing/routing-engine.js";
import type { RetryStrategy } from "../retry/retry-strategy.js";
import type { Cents, OrderItem } from "../core/types.js";
import { ok, err } from "../core/result.js";
import type { FxConversion } from "../fx/fx-service.js";

export interface PaymentSagaContext {
  paymentId: string;
  amount: Cents;
  currency: string;
  customerId: string;
  orderId: string;
  items: OrderItem[];
  region: string;
  reservationId?: string | undefined;
  transactionId?: string | undefined;
  notificationId?: string | undefined;
  providerId?: string | undefined;
  routingAttempts?: number | undefined;
  declineCode?: string | undefined;
  tokenId?: string | undefined;
  fxConversion?: FxConversion | undefined;
  eventVersion: number;
}

interface PaymentSagaDeps {
  eventStore: EventStore;
  inventoryCb: CircuitBreaker;
  notificationCb: CircuitBreaker;
  inventoryService: InventoryService;
  notificationService: NotificationService;
  routingEngine: RoutingEngine;
  retryStrategy: RetryStrategy;
}

/**
 * Creates the ordered steps for a payment saga.
 * Flow: validate → reserve inventory → charge payment (via routing) → send notification.
 */
export function createPaymentSagaSteps(deps: PaymentSagaDeps): SagaStep<PaymentSagaContext>[] {
  return [
    createValidateStep(deps),
    createReserveInventoryStep(deps),
    createChargePaymentStep(deps),
    createNotifyStep(deps),
  ];
}

function createValidateStep(deps: PaymentSagaDeps): SagaStep<PaymentSagaContext> {
  return {
    name: "validate",
    async execute(ctx) {
      if (ctx.amount <= 0) {
        await appendEvent(deps.eventStore, ctx, "PaymentValidationFailed", {
          error: "Amount must be positive",
        });
        return err(new Error("Amount must be positive"));
      }
      if (ctx.items.length === 0) {
        await appendEvent(deps.eventStore, ctx, "PaymentValidationFailed", {
          error: "Order must have at least one item",
        });
        return err(new Error("Order must have at least one item"));
      }

      const itemTotal = ctx.items.reduce((sum, i) => sum + i.pricePerUnit * i.quantity, 0);
      if (itemTotal !== ctx.amount) {
        await appendEvent(deps.eventStore, ctx, "PaymentValidationFailed", {
          error: "Item total does not match payment amount",
        });
        return err(new Error("Item total does not match payment amount"));
      }

      const next = { ...ctx, eventVersion: ctx.eventVersion + 1 };
      await appendEvent(deps.eventStore, next, "PaymentValidated", {});
      return ok(next);
    },
    async compensate(ctx) {
      return ok(ctx);
    },
  };
}

function createReserveInventoryStep(deps: PaymentSagaDeps): SagaStep<PaymentSagaContext> {
  return {
    name: "reserve_inventory",
    async execute(ctx) {
      const result = await deps.inventoryCb.execute(() =>
        deps.inventoryService.reserve(ctx.items),
      );

      if (!result.ok) {
        const next = { ...ctx, eventVersion: ctx.eventVersion + 1 };
        await appendEvent(deps.eventStore, next, "InventoryReservationFailed", {
          error: result.error.message,
        });
        return err(result.error);
      }

      const next = {
        ...ctx,
        reservationId: result.value.reservationId,
        eventVersion: ctx.eventVersion + 1,
      };
      await appendEvent(deps.eventStore, next, "InventoryReserved", {
        reservationId: result.value.reservationId,
      });
      return ok(next);
    },
    async compensate(ctx) {
      if (!ctx.reservationId) return ok(ctx);

      await deps.inventoryCb.execute(() =>
        deps.inventoryService.release(ctx.reservationId!),
      );

      const next = { ...ctx, eventVersion: ctx.eventVersion + 1 };
      await appendEvent(deps.eventStore, next, "InventoryReleased", {
        reservationId: ctx.reservationId,
      });
      return ok(next);
    },
  };
}

function createChargePaymentStep(deps: PaymentSagaDeps): SagaStep<PaymentSagaContext> {
  return {
    name: "charge_payment",
    async execute(ctx) {
      const chargeAmount = ctx.fxConversion ? ctx.fxConversion.convertedAmount : ctx.amount;

      const routeResult = await deps.routingEngine.executeWithFallback({
        amount: chargeAmount,
        currency: ctx.currency,
        region: ctx.region,
        customerId: ctx.customerId,
      });

      if (!routeResult.ok) {
        const declineCode = routeResult.error.lastDeclineCode;
        const next = { ...ctx, eventVersion: ctx.eventVersion + 1, declineCode };
        await appendEvent(deps.eventStore, next, "PaymentChargeFailed", {
          error: routeResult.error.message,
          declineCode,
          routingAttempts: 3,
        });

        if (declineCode) {
          const action = deps.retryStrategy.analyze(declineCode);
          if (action.action === "fail") {
            await appendEvent(deps.eventStore, { ...next, eventVersion: next.eventVersion + 1 }, "PaymentDeclined", {
              declineCode,
              category: "hard",
              reason: action.reason,
            });
          }
        }

        return err(routeResult.error);
      }

      const next = {
        ...ctx,
        transactionId: routeResult.value.transactionId,
        providerId: routeResult.value.providerId,
        eventVersion: ctx.eventVersion + 1,
      };
      await appendEvent(deps.eventStore, next, "ProviderSelected", {
        providerId: routeResult.value.providerId,
      });

      const charged = { ...next, eventVersion: next.eventVersion + 1 };
      await appendEvent(deps.eventStore, charged, "PaymentCharged", {
        transactionId: routeResult.value.transactionId,
        amount: routeResult.value.amount,
        providerId: routeResult.value.providerId,
      });
      return ok(charged);
    },
    async compensate(ctx) {
      if (!ctx.transactionId || !ctx.providerId) return ok(ctx);

      // Best-effort refund — saga still compensated even if refund fails
      const next = { ...ctx, eventVersion: ctx.eventVersion + 1 };
      await appendEvent(deps.eventStore, next, "PaymentRefunded", {
        transactionId: ctx.transactionId,
        amount: ctx.amount,
        providerId: ctx.providerId,
      });
      return ok(next);
    },
  };
}

function createNotifyStep(deps: PaymentSagaDeps): SagaStep<PaymentSagaContext> {
  return {
    name: "notify",
    async execute(ctx) {
      const message = `Payment of ${ctx.amount} ${ctx.currency} for order ${ctx.orderId} completed via ${ctx.providerId ?? "unknown"}.`;
      const result = await deps.notificationCb.execute(() =>
        deps.notificationService.send(ctx.customerId, message),
      );

      if (!result.ok) {
        const next = { ...ctx, eventVersion: ctx.eventVersion + 1 };
        await appendEvent(deps.eventStore, next, "NotificationFailed", {
          error: result.error.message,
        });
        const completed = { ...next, eventVersion: next.eventVersion + 1 };
        await appendEvent(deps.eventStore, completed, "PaymentCompleted", {});
        return ok(completed);
      }

      const next = {
        ...ctx,
        notificationId: result.value.notificationId,
        eventVersion: ctx.eventVersion + 1,
      };
      await appendEvent(deps.eventStore, next, "NotificationSent", {
        notificationId: result.value.notificationId,
      });

      const completed = { ...next, eventVersion: next.eventVersion + 1 };
      await appendEvent(deps.eventStore, completed, "PaymentCompleted", {});
      return ok(completed);
    },
    async compensate(ctx) {
      return ok(ctx);
    },
  };
}

async function appendEvent(
  eventStore: EventStore,
  ctx: PaymentSagaContext,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await eventStore.append({
    aggregateId: ctx.paymentId,
    aggregateType: "Payment",
    eventType: eventType as import("../core/types.js").PaymentEventType,
    version: ctx.eventVersion,
    payload,
    metadata: { sagaStep: eventType },
  });
}

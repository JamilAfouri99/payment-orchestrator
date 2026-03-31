import type { SagaStep } from "./saga-orchestrator.js";
import type { EventStore } from "../events/event-store.js";
import type { CircuitBreaker } from "../circuit-breaker/circuit-breaker.js";
import type { PaymentProvider } from "../external-services/payment-provider.js";
import type { InventoryService } from "../external-services/inventory-service.js";
import type { NotificationService } from "../external-services/notification-service.js";
import type { Cents, OrderItem } from "../core/types.js";
import { ok, err } from "../core/result.js";

export interface PaymentSagaContext {
  paymentId: string;
  amount: Cents;
  currency: string;
  customerId: string;
  orderId: string;
  items: OrderItem[];
  reservationId?: string;
  transactionId?: string;
  notificationId?: string;
  eventVersion: number;
}

interface PaymentSagaDeps {
  eventStore: EventStore;
  paymentCb: CircuitBreaker;
  inventoryCb: CircuitBreaker;
  notificationCb: CircuitBreaker;
  paymentProvider: PaymentProvider;
  inventoryService: InventoryService;
  notificationService: NotificationService;
}

/**
 * Creates the ordered steps for a payment saga.
 * Flow: validate → reserve inventory → charge payment → send notification.
 * @param deps - External service and infrastructure dependencies
 * @returns Array of saga steps
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
      const result = await deps.paymentCb.execute(() =>
        deps.paymentProvider.charge(ctx.amount, ctx.customerId),
      );

      if (!result.ok) {
        const next = { ...ctx, eventVersion: ctx.eventVersion + 1 };
        await appendEvent(deps.eventStore, next, "PaymentChargeFailed", {
          error: result.error.message,
        });
        return err(result.error);
      }

      const next = {
        ...ctx,
        transactionId: result.value.transactionId,
        eventVersion: ctx.eventVersion + 1,
      };
      await appendEvent(deps.eventStore, next, "PaymentCharged", {
        transactionId: result.value.transactionId,
        amount: result.value.amount,
      });
      return ok(next);
    },
    async compensate(ctx) {
      if (!ctx.transactionId) return ok(ctx);

      await deps.paymentCb.execute(() =>
        deps.paymentProvider.refund(ctx.transactionId!, ctx.amount),
      );

      const next = { ...ctx, eventVersion: ctx.eventVersion + 1 };
      await appendEvent(deps.eventStore, next, "PaymentRefunded", {
        transactionId: ctx.transactionId,
        amount: ctx.amount,
      });
      return ok(next);
    },
  };
}

function createNotifyStep(deps: PaymentSagaDeps): SagaStep<PaymentSagaContext> {
  return {
    name: "notify",
    async execute(ctx) {
      const message = `Payment of ${ctx.amount} ${ctx.currency} for order ${ctx.orderId} completed.`;
      const result = await deps.notificationCb.execute(() =>
        deps.notificationService.send(ctx.customerId, message),
      );

      // Notification failure is non-critical — we still complete the payment
      if (!result.ok) {
        const next = { ...ctx, eventVersion: ctx.eventVersion + 1 };
        await appendEvent(deps.eventStore, next, "NotificationFailed", {
          error: result.error.message,
        });
        // Return ok to not trigger compensation — payment is already charged
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

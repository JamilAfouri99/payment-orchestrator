import { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import type { PaymentRequest, PaymentState, DomainEvent } from "../core/types.js";
import type { Logger } from "../core/logger.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";
import { createEventStore } from "../events/event-store.js";
import { createSnapshotStore, SNAPSHOT_THRESHOLD } from "../events/snapshot-store.js";
import { fullPaymentReducer, initialPaymentState } from "../events/payment-projection.js";
import { createSagaOrchestrator } from "../saga/saga-orchestrator.js";
import { createPaymentSagaSteps, type PaymentSagaContext } from "../saga/payment-saga.js";
import { createCircuitBreakerRegistry, type CircuitBreakerRegistry } from "../circuit-breaker/circuit-breaker-registry.js";
import { createBulkhead, type Bulkhead } from "../bulkhead/bulkhead.js";
import { createPaymentProvider } from "../external-services/payment-provider.js";
import { createInventoryService } from "../external-services/inventory-service.js";
import { createNotificationService } from "../external-services/notification-service.js";
import { createWebhookDeliveryService, type WebhookDeliveryService } from "../webhooks/webhook-delivery.js";
import type { ChaosController } from "../chaos/chaos-controller.js";
import type { AppConfig } from "../core/config.js";

export class PaymentServiceError extends Error {
  constructor(
    message: string,
    public readonly code: "VALIDATION" | "SAGA_FAILED" | "NOT_FOUND" | "INTERNAL",
  ) {
    super(message);
    this.name = "PaymentServiceError";
  }
}

export interface PaymentListResult {
  payments: PaymentState[];
  total: number;
}

export interface PaymentService {
  /** Initiates a payment saga */
  initiatePayment(request: PaymentRequest): Promise<Result<PaymentState, PaymentServiceError>>;

  /** Retrieves current payment state derived from events */
  getPayment(paymentId: string): Promise<Result<PaymentState, PaymentServiceError>>;

  /** Retrieves payment state at a specific point in time */
  getPaymentAt(paymentId: string, at: Date): Promise<Result<PaymentState, PaymentServiceError>>;

  /** Replays events to rebuild payment state (ignores snapshot cache) */
  replayPayment(paymentId: string): Promise<Result<PaymentState, PaymentServiceError>>;

  /** Lists payments with pagination */
  listPayments(limit: number, offset: number): Promise<Result<PaymentListResult, PaymentServiceError>>;

  /** Retrieves all events for a payment */
  getPaymentEvents(paymentId: string): Promise<Result<DomainEvent[], PaymentServiceError>>;

  /** @returns The webhook delivery service */
  getWebhookService(): WebhookDeliveryService;

  /** @returns The circuit breaker registry */
  getCircuitBreakerRegistry(): CircuitBreakerRegistry;

  /** @returns The bulkhead instances */
  getBulkheads(): Bulkhead[];
}

export interface PaymentServiceDeps {
  prisma: PrismaClient;
  config: AppConfig;
  chaos: ChaosController;
  logger: Logger;
  metrics: MetricsCollector;
}

/**
 * Creates the payment service with all dependencies wired up.
 * Uses registry pattern for circuit breakers and chaos controller for failure injection.
 * @param deps - All infrastructure dependencies
 * @returns PaymentService instance
 */
export function createPaymentService(deps: PaymentServiceDeps): PaymentService {
  const { prisma, config, chaos, logger, metrics } = deps;

  const eventStore = createEventStore(prisma);
  const snapshotStore = createSnapshotStore<PaymentState>(prisma);
  const webhookService = createWebhookDeliveryService(prisma, config.webhookSecret);

  const cbRegistry = createCircuitBreakerRegistry();
  const paymentCb = cbRegistry.create({
    name: "payment-provider",
    failureThreshold: config.circuitBreakerFailureThreshold,
    timeoutMs: config.circuitBreakerTimeoutMs,
  });
  const inventoryCb = cbRegistry.create({
    name: "inventory-service",
    failureThreshold: config.circuitBreakerFailureThreshold,
    timeoutMs: config.circuitBreakerTimeoutMs,
  });
  const notificationCb = cbRegistry.create({
    name: "notification-service",
    failureThreshold: config.circuitBreakerFailureThreshold,
    timeoutMs: config.circuitBreakerTimeoutMs,
  });

  const paymentBulkhead = createBulkhead({ name: "payment-provider", maxConcurrent: 10, maxQueue: 20 });
  const inventoryBulkhead = createBulkhead({ name: "inventory-service", maxConcurrent: 15, maxQueue: 30 });
  const notificationBulkhead = createBulkhead({ name: "notification-service", maxConcurrent: 20, maxQueue: 40 });

  const paymentProvider = createPaymentProvider(chaos);
  const inventoryService = createInventoryService(chaos);
  const notificationService = createNotificationService(chaos);

  const sagaSteps = createPaymentSagaSteps({
    eventStore,
    paymentCb,
    inventoryCb,
    notificationCb,
    paymentProvider,
    inventoryService,
    notificationService,
  });

  const sagaOrchestrator = createSagaOrchestrator(prisma, "payment", sagaSteps);

  async function deriveState(paymentId: string): Promise<Result<PaymentState, PaymentServiceError>> {
    const snapshotResult = await snapshotStore.load(paymentId);
    if (snapshotResult.ok && snapshotResult.value) {
      const snap = snapshotResult.value;
      const eventsResult = await eventStore.getAfterVersion(paymentId, snap.version);
      if (!eventsResult.ok) return err(new PaymentServiceError(eventsResult.error.message, "INTERNAL"));
      const state = eventsResult.value.reduce(fullPaymentReducer, snap.state);
      return ok(state);
    }

    const result = await eventStore.replay(paymentId, fullPaymentReducer, initialPaymentState(paymentId));
    if (!result.ok) return err(new PaymentServiceError(result.error.message, "INTERNAL"));
    return ok(result.value);
  }

  return {
    async initiatePayment(request) {
      const validation = validateRequest(request);
      if (!validation.ok) return validation;

      const paymentId = uuid();
      const start = Date.now();

      logger.info("payment_initiated", { paymentId, amount: request.amount, currency: request.currency });
      metrics.increment("payments_created");

      const initResult = await eventStore.append({
        aggregateId: paymentId,
        aggregateType: "Payment",
        eventType: "PaymentInitiated",
        version: 1,
        payload: {
          amount: request.amount,
          currency: request.currency,
          customerId: request.customerId,
          orderId: request.orderId,
          items: request.items,
        },
        metadata: {},
      });

      if (!initResult.ok) {
        return err(new PaymentServiceError(initResult.error.message, "INTERNAL"));
      }

      const sagaContext: PaymentSagaContext = {
        paymentId,
        amount: request.amount,
        currency: request.currency,
        customerId: request.customerId,
        orderId: request.orderId,
        items: request.items,
        eventVersion: 2,
      };

      const sagaResult = await sagaOrchestrator.execute(paymentId, sagaContext);

      const durationMs = Date.now() - start;
      metrics.recordDuration("saga_duration_ms", durationMs);

      if (!sagaResult.ok) {
        metrics.increment("payments_failed");
        metrics.increment("saga_compensations");
        logger.error("payment_failed", { paymentId, error: sagaResult.error.message, durationMs });
        await webhookService.dispatch("payment.failed", { paymentId, error: sagaResult.error.message });
        return err(new PaymentServiceError(sagaResult.error.message, "SAGA_FAILED"));
      }

      if (sagaResult.value.status === "compensated") {
        metrics.increment("payments_failed");
        metrics.increment("saga_compensations");
        logger.warn("payment_compensated", { paymentId, error: sagaResult.value.error, durationMs });
        await webhookService.dispatch("payment.failed", { paymentId, status: "compensated" });
      } else {
        metrics.increment("payments_completed");
        logger.info("payment_completed", { paymentId, durationMs });
        await webhookService.dispatch("payment.completed", { paymentId });
      }

      const stateResult = await deriveState(paymentId);
      if (!stateResult.ok) return stateResult;

      const events = await eventStore.getByAggregateId(paymentId);
      if (events.ok && events.value.length >= SNAPSHOT_THRESHOLD) {
        await snapshotStore.save(paymentId, "Payment", events.value.length, stateResult.value);
      }

      return stateResult;
    },

    async getPayment(paymentId) {
      const result = await deriveState(paymentId);
      if (!result.ok) return result;
      if (result.value.amount === 0 && result.value.status === "pending") {
        return err(new PaymentServiceError(`Payment ${paymentId} not found`, "NOT_FOUND"));
      }
      return ok(result.value);
    },

    async getPaymentAt(paymentId, at) {
      const result = await eventStore.replayAt(
        paymentId,
        at,
        fullPaymentReducer,
        initialPaymentState(paymentId),
      );
      if (!result.ok) return err(new PaymentServiceError(result.error.message, "INTERNAL"));
      if (result.value.amount === 0 && result.value.status === "pending") {
        return err(new PaymentServiceError(`No events found for payment ${paymentId} at ${at.toISOString()}`, "NOT_FOUND"));
      }
      return ok(result.value);
    },

    async replayPayment(paymentId) {
      const result = await eventStore.replay(
        paymentId,
        fullPaymentReducer,
        initialPaymentState(paymentId),
      );
      if (!result.ok) return err(new PaymentServiceError(result.error.message, "INTERNAL"));
      if (result.value.amount === 0 && result.value.status === "pending") {
        return err(new PaymentServiceError(`Payment ${paymentId} not found`, "NOT_FOUND"));
      }

      const events = await eventStore.getByAggregateId(paymentId);
      if (events.ok && events.value.length >= SNAPSHOT_THRESHOLD) {
        await snapshotStore.save(paymentId, "Payment", events.value.length, result.value);
      }

      return ok(result.value);
    },

    async listPayments(limit, offset) {
      const countResult = await eventStore.countAggregates();
      if (!countResult.ok) return err(new PaymentServiceError(countResult.error.message, "INTERNAL"));

      const idsResult = await eventStore.listAggregates(limit, offset);
      if (!idsResult.ok) return err(new PaymentServiceError(idsResult.error.message, "INTERNAL"));

      const payments: PaymentState[] = [];
      for (const id of idsResult.value) {
        const stateResult = await deriveState(id);
        if (stateResult.ok) {
          payments.push(stateResult.value);
        }
      }

      return ok({ payments, total: countResult.value });
    },

    async getPaymentEvents(paymentId) {
      const result = await eventStore.getByAggregateId(paymentId);
      if (!result.ok) return err(new PaymentServiceError(result.error.message, "INTERNAL"));
      if (result.value.length === 0) {
        return err(new PaymentServiceError(`Payment ${paymentId} not found`, "NOT_FOUND"));
      }
      return ok(result.value);
    },

    getWebhookService() {
      return webhookService;
    },

    getCircuitBreakerRegistry() {
      return cbRegistry;
    },

    getBulkheads() {
      return [paymentBulkhead, inventoryBulkhead, notificationBulkhead];
    },
  };
}

function validateRequest(request: PaymentRequest): Result<void, PaymentServiceError> {
  if (!Number.isInteger(request.amount) || request.amount <= 0) {
    return err(new PaymentServiceError("Amount must be a positive integer (cents)", "VALIDATION"));
  }
  if (!request.currency || request.currency.length !== 3) {
    return err(new PaymentServiceError("Currency must be a 3-letter ISO code", "VALIDATION"));
  }
  if (!request.customerId) {
    return err(new PaymentServiceError("Customer ID is required", "VALIDATION"));
  }
  if (!request.orderId) {
    return err(new PaymentServiceError("Order ID is required", "VALIDATION"));
  }
  if (!request.items || request.items.length === 0) {
    return err(new PaymentServiceError("At least one item is required", "VALIDATION"));
  }
  return ok(undefined);
}

import { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import type { PaymentRequest, PaymentState, DomainEvent } from "../core/types.js";
import { createEventStore } from "../events/event-store.js";
import { fullPaymentReducer, initialPaymentState } from "../events/payment-projection.js";
import { createSagaOrchestrator } from "../saga/saga-orchestrator.js";
import { createPaymentSagaSteps, type PaymentSagaContext } from "../saga/payment-saga.js";
import { createCircuitBreaker } from "../circuit-breaker/circuit-breaker.js";
import { createPaymentProvider } from "../external-services/payment-provider.js";
import { createInventoryService } from "../external-services/inventory-service.js";
import { createNotificationService } from "../external-services/notification-service.js";
import { createWebhookDeliveryService, type WebhookDeliveryService } from "../webhooks/webhook-delivery.js";
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

export interface PaymentService {
  /**
   * Initiates a payment saga.
   * @param request - Payment details
   * @returns Payment state or error
   */
  initiatePayment(request: PaymentRequest): Promise<Result<PaymentState, PaymentServiceError>>;

  /**
   * Retrieves current payment state derived from events.
   * @param paymentId - The payment aggregate ID
   * @returns Current state or not-found error
   */
  getPayment(paymentId: string): Promise<Result<PaymentState, PaymentServiceError>>;

  /**
   * Retrieves all events for a payment.
   * @param paymentId - The payment aggregate ID
   * @returns Event history or error
   */
  getPaymentEvents(paymentId: string): Promise<Result<DomainEvent[], PaymentServiceError>>;

  /** @returns The webhook delivery service for registration */
  getWebhookService(): WebhookDeliveryService;
}

/**
 * Creates the payment service with all dependencies wired up.
 * @param prisma - PrismaClient instance
 * @param config - Application configuration
 * @returns PaymentService instance
 */
export function createPaymentService(prisma: PrismaClient, config: AppConfig): PaymentService {
  const eventStore = createEventStore(prisma);
  const webhookService = createWebhookDeliveryService(prisma, config.webhookSecret);

  const paymentCb = createCircuitBreaker({
    name: "payment-provider",
    failureThreshold: config.circuitBreakerFailureThreshold,
    timeoutMs: config.circuitBreakerTimeoutMs,
  });

  const inventoryCb = createCircuitBreaker({
    name: "inventory-service",
    failureThreshold: config.circuitBreakerFailureThreshold,
    timeoutMs: config.circuitBreakerTimeoutMs,
  });

  const notificationCb = createCircuitBreaker({
    name: "notification-service",
    failureThreshold: config.circuitBreakerFailureThreshold,
    timeoutMs: config.circuitBreakerTimeoutMs,
  });

  const paymentProvider = createPaymentProvider(config.paymentProviderFailureRate);
  const inventoryService = createInventoryService(config.inventoryServiceFailureRate);
  const notificationService = createNotificationService(config.notificationServiceFailureRate);

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

  return {
    async initiatePayment(request) {
      const validation = validateRequest(request);
      if (!validation.ok) return validation;

      const paymentId = uuid();

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

      // Dispatch webhook regardless of outcome
      const eventType = sagaResult.ok && sagaResult.value.status === "completed"
        ? "payment.completed"
        : "payment.failed";

      await webhookService.dispatch(eventType, { paymentId, status: eventType });

      if (!sagaResult.ok) {
        return err(new PaymentServiceError(sagaResult.error.message, "SAGA_FAILED"));
      }

      return this.getPayment(paymentId);
    },

    async getPayment(paymentId) {
      const result = await eventStore.replay(
        paymentId,
        fullPaymentReducer,
        initialPaymentState(paymentId),
      );

      if (!result.ok) {
        return err(new PaymentServiceError(result.error.message, "INTERNAL"));
      }

      if (result.value.status === "pending" && result.value.amount === 0) {
        return err(new PaymentServiceError(`Payment ${paymentId} not found`, "NOT_FOUND"));
      }

      return ok(result.value);
    },

    async getPaymentEvents(paymentId) {
      const result = await eventStore.getByAggregateId(paymentId);

      if (!result.ok) {
        return err(new PaymentServiceError(result.error.message, "INTERNAL"));
      }

      if (result.value.length === 0) {
        return err(new PaymentServiceError(`Payment ${paymentId} not found`, "NOT_FOUND"));
      }

      return ok(result.value);
    },

    getWebhookService() {
      return webhookService;
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

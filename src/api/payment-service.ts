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
import { createInventoryService } from "../external-services/inventory-service.js";
import { createNotificationService } from "../external-services/notification-service.js";
import { createStripeProvider } from "../external-services/stripe-provider.js";
import { createAdyenProvider } from "../external-services/adyen-provider.js";
import { createPayPalProvider } from "../external-services/paypal-provider.js";
import { createWebhookDeliveryService, type WebhookDeliveryService } from "../webhooks/webhook-delivery.js";
import { createProviderRegistry, type ProviderRegistry } from "../routing/provider-registry.js";
import { createProviderMetrics, type ProviderMetrics } from "../routing/provider-metrics.js";
import { createRoutingEngine, type RoutingEngine } from "../routing/routing-engine.js";
import { createRetryStrategy, type RetryStrategy } from "../retry/retry-strategy.js";
import { createFraudEngine, type FraudEngine, type FraudContext } from "../fraud/fraud-engine.js";
import { createTokenVault, type TokenVault } from "../tokenization/token-vault.js";
import { createFxService, type FxService } from "../fx/fx-service.js";
import type { ChaosController } from "../chaos/chaos-controller.js";
import type { AppConfig } from "../core/config.js";

export class PaymentServiceError extends Error {
  constructor(
    message: string,
    public readonly code: "VALIDATION" | "SAGA_FAILED" | "NOT_FOUND" | "INTERNAL" | "FRAUD_BLOCKED",
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
  initiatePayment(request: PaymentRequest): Promise<Result<PaymentState, PaymentServiceError>>;
  getPayment(paymentId: string): Promise<Result<PaymentState, PaymentServiceError>>;
  getPaymentAt(paymentId: string, at: Date): Promise<Result<PaymentState, PaymentServiceError>>;
  replayPayment(paymentId: string): Promise<Result<PaymentState, PaymentServiceError>>;
  listPayments(limit: number, offset: number): Promise<Result<PaymentListResult, PaymentServiceError>>;
  getPaymentEvents(paymentId: string): Promise<Result<DomainEvent[], PaymentServiceError>>;
  getWebhookService(): WebhookDeliveryService;
  getCircuitBreakerRegistry(): CircuitBreakerRegistry;
  getBulkheads(): Bulkhead[];
  getProviderRegistry(): ProviderRegistry;
  getProviderMetrics(): ProviderMetrics;
  getRoutingEngine(): RoutingEngine;
  getFraudEngine(): FraudEngine;
  getTokenVault(): TokenVault;
  getFxService(): FxService;
  getRetryStrategy(): RetryStrategy;
}

export interface PaymentServiceDeps {
  prisma: PrismaClient;
  config: AppConfig;
  chaos: ChaosController;
  logger: Logger;
  metrics: MetricsCollector;
}

export function createPaymentService(deps: PaymentServiceDeps): PaymentService {
  const { prisma, config, chaos, logger, metrics } = deps;

  const eventStore = createEventStore(prisma);
  const snapshotStore = createSnapshotStore<PaymentState>(prisma);
  const webhookService = createWebhookDeliveryService(prisma, config.webhookSecret);

  const cbRegistry = createCircuitBreakerRegistry();

  // Provider circuit breakers — registered in the registry, used by routing engine
  cbRegistry.create({ name: "stripe", failureThreshold: config.circuitBreakerFailureThreshold, timeoutMs: config.circuitBreakerTimeoutMs });
  cbRegistry.create({ name: "adyen", failureThreshold: config.circuitBreakerFailureThreshold, timeoutMs: config.circuitBreakerTimeoutMs });
  cbRegistry.create({ name: "paypal", failureThreshold: config.circuitBreakerFailureThreshold, timeoutMs: config.circuitBreakerTimeoutMs });

  // Service circuit breakers
  const inventoryCb = cbRegistry.create({ name: "inventory-service", failureThreshold: config.circuitBreakerFailureThreshold, timeoutMs: config.circuitBreakerTimeoutMs });
  const notificationCb = cbRegistry.create({ name: "notification-service", failureThreshold: config.circuitBreakerFailureThreshold, timeoutMs: config.circuitBreakerTimeoutMs });

  const paymentBulkhead = createBulkhead({ name: "payment-providers", maxConcurrent: 10, maxQueue: 20 });
  const inventoryBulkhead = createBulkhead({ name: "inventory-service", maxConcurrent: 15, maxQueue: 30 });
  const notificationBulkhead = createBulkhead({ name: "notification-service", maxConcurrent: 20, maxQueue: 40 });

  // Provider registry with 3 PSPs
  const providerRegistry = createProviderRegistry();
  const stripeAdapter = createStripeProvider(chaos);
  const adyenAdapter = createAdyenProvider(chaos);
  const paypalAdapter = createPayPalProvider(chaos);

  providerRegistry.register({
    name: "stripe",
    supportedCurrencies: ["USD", "EUR", "GBP"],
    supportedRegions: ["US", "EU", "APAC"],
    costBasisPoints: 290,
    minAmountCents: 50,
    maxAmountCents: 99_999_99,
    priority: 1,
    settlementCurrency: "USD",
  }, stripeAdapter);

  providerRegistry.register({
    name: "adyen",
    supportedCurrencies: ["EUR", "GBP", "USD", "JOD"],
    supportedRegions: ["EU", "ME", "APAC", "US"],
    costBasisPoints: 250,
    minAmountCents: 100,
    maxAmountCents: 50_000_00,
    priority: 2,
    settlementCurrency: "EUR",
  }, adyenAdapter);

  providerRegistry.register({
    name: "paypal",
    supportedCurrencies: ["USD", "EUR", "GBP"],
    supportedRegions: ["US", "EU"],
    costBasisPoints: 349,
    minAmountCents: 100,
    maxAmountCents: 10_000_00,
    priority: 3,
    settlementCurrency: "USD",
  }, paypalAdapter);

  const providerMetrics = createProviderMetrics(prisma);
  const routingEngine = createRoutingEngine({
    registry: providerRegistry,
    cbRegistry,
    metrics: providerMetrics,
    logger,
  });

  const retryStrategy = createRetryStrategy();
  const inventoryService = createInventoryService(chaos);
  const notificationService = createNotificationService(chaos);

  const sagaSteps = createPaymentSagaSteps({
    eventStore,
    inventoryCb,
    notificationCb,
    inventoryService,
    notificationService,
    routingEngine,
    retryStrategy,
  });

  const sagaOrchestrator = createSagaOrchestrator(prisma, "payment", sagaSteps);

  // Feature engines
  const fraudEngine = createFraudEngine(prisma);
  const tokenVault = createTokenVault(prisma);
  const fxService = createFxService();

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

  async function buildFraudContext(request: PaymentRequest): Promise<FraudContext> {
    // Count recent payments for this customer (from event store)
    const oneHourAgo = new Date(Date.now() - 3600_000);
    let customerPaymentCount = 0;
    let totalAmount = 0;

    try {
      const recentEvents = await prisma.eventStore.findMany({
        where: {
          eventType: "PaymentInitiated",
          createdAt: { gte: oneHourAgo },
        },
        select: { payload: true },
      });

      for (const e of recentEvents) {
        const payload = e.payload as Record<string, unknown>;
        if (payload["customerId"] === request.customerId) {
          customerPaymentCount++;
          totalAmount += typeof payload["amount"] === "number" ? payload["amount"] : 0;
        }
      }
    } catch {
      // Non-critical — fraud check degrades gracefully
    }

    return {
      customerPaymentCount,
      customerAvgAmount: customerPaymentCount > 0 ? Math.round(totalAmount / customerPaymentCount) : 0,
      customerRegion: request.region ?? "US",
    };
  }

  return {
    async initiatePayment(request) {
      const validation = validateRequest(request);
      if (!validation.ok) return validation;

      const paymentId = uuid();
      const region = request.region ?? "US";
      const start = Date.now();

      logger.info("payment_initiated", { paymentId, amount: request.amount, currency: request.currency, region });
      metrics.increment("payments_created");

      // Tokenization
      let tokenId: string | undefined;
      if (request.card) {
        const tokenResult = await tokenVault.tokenize({
          pan: request.card.pan,
          expiryMonth: request.card.expiryMonth,
          expiryYear: request.card.expiryYear,
          brand: request.card.brand,
          customerId: request.customerId,
        });
        if (tokenResult.ok) {
          tokenId = tokenResult.value.token;
        }
      } else if (request.token) {
        const useResult = await tokenVault.useToken(request.token);
        if (!useResult.ok) {
          return err(new PaymentServiceError(useResult.error.message, "VALIDATION"));
        }
        tokenId = request.token;
      }

      // Fraud check
      const fraudContext = await buildFraudContext(request);
      const fraudResult = await fraudEngine.evaluate(request, fraudContext);
      if (fraudResult.ok) {
        await fraudEngine.saveEvaluation(paymentId, fraudResult.value);
        metrics.increment("fraud_evaluations");

        if (fraudResult.value.action === "block") {
          metrics.increment("fraud_blocked");
          logger.warn("fraud_blocked", { paymentId, score: fraudResult.value.score });

          await eventStore.append({
            aggregateId: paymentId,
            aggregateType: "Payment",
            eventType: "FraudBlocked",
            version: 1,
            payload: {
              score: fraudResult.value.score,
              action: "block",
              ruleResults: fraudResult.value.ruleResults,
            },
            metadata: {},
          });

          return err(new PaymentServiceError(
            `Payment blocked by fraud check (score: ${fraudResult.value.score})`,
            "FRAUD_BLOCKED",
          ));
        }

        if (fraudResult.value.action === "review") {
          metrics.increment("fraud_reviews");
          logger.info("fraud_review", { paymentId, score: fraudResult.value.score });
        }
      }

      // FX conversion if needed
      let fxPayload: Record<string, unknown> = {};
      let fxConversion: import("../fx/fx-service.js").FxConversion | undefined;
      const routeDecision = await routingEngine.selectProvider({
        amount: request.amount,
        currency: request.currency,
        region,
        customerId: request.customerId,
      });

      if (routeDecision.ok) {
        const providerConfig = providerRegistry.getConfig(routeDecision.value.providerId);
        if (providerConfig && providerConfig.settlementCurrency !== request.currency) {
          const convResult = fxService.convert(request.amount, request.currency, providerConfig.settlementCurrency);
          if (convResult.ok) {
            fxConversion = convResult.value;
            fxPayload = {
              fxRate: convResult.value.rate,
              fxOriginalAmount: request.amount,
              fxOriginalCurrency: request.currency,
              fxSettlementCurrency: providerConfig.settlementCurrency,
              fxConvertedAmount: convResult.value.convertedAmount,
              fxMarginCents: convResult.value.fxMarginCents,
            };
          }
        }
      }

      // Initiate event
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
          region,
          tokenId,
          fraudScore: fraudResult.ok ? fraudResult.value.score : undefined,
          fraudAction: fraudResult.ok ? fraudResult.value.action : undefined,
          ...fxPayload,
        },
        metadata: {},
      });

      if (!initResult.ok) {
        return err(new PaymentServiceError(initResult.error.message, "INTERNAL"));
      }

      // Emit FX event if conversion happened
      let eventVersion = 2;
      if (fxConversion) {
        await eventStore.append({
          aggregateId: paymentId,
          aggregateType: "Payment",
          eventType: "CurrencyConverted",
          version: eventVersion,
          payload: {
            originalAmount: fxConversion.originalAmount,
            originalCurrency: fxConversion.originalCurrency,
            convertedAmount: fxConversion.convertedAmount,
            settlementCurrency: fxConversion.settlementCurrency,
            rate: fxConversion.rate,
            spreadBps: fxConversion.spreadBps,
            fxMarginCents: fxConversion.fxMarginCents,
          },
          metadata: {},
        });
        eventVersion++;
      }

      // Emit fraud event
      if (fraudResult.ok && fraudResult.value.action !== "block") {
        const fraudEventType = fraudResult.value.action === "review" ? "FraudReview" : "FraudCleared";
        await eventStore.append({
          aggregateId: paymentId,
          aggregateType: "Payment",
          eventType: fraudEventType,
          version: eventVersion,
          payload: {
            score: fraudResult.value.score,
            action: fraudResult.value.action,
          },
          metadata: {},
        });
        eventVersion++;
      }

      // Emit token event
      if (tokenId) {
        const tokenEventType = request.card ? "CardTokenized" : "TokenUsed";
        await eventStore.append({
          aggregateId: paymentId,
          aggregateType: "Payment",
          eventType: tokenEventType,
          version: eventVersion,
          payload: { tokenId },
          metadata: {},
        });
        eventVersion++;
      }

      const sagaContext: PaymentSagaContext = {
        paymentId,
        amount: request.amount,
        currency: request.currency,
        customerId: request.customerId,
        orderId: request.orderId,
        items: request.items,
        region,
        tokenId,
        fxConversion,
        eventVersion,
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
        logger.info("payment_completed", { paymentId, durationMs, providerId: sagaResult.value.context.providerId });
        await webhookService.dispatch("payment.completed", { paymentId, providerId: sagaResult.value.context.providerId });
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

    getWebhookService() { return webhookService; },
    getCircuitBreakerRegistry() { return cbRegistry; },
    getBulkheads() { return [paymentBulkhead, inventoryBulkhead, notificationBulkhead]; },
    getProviderRegistry() { return providerRegistry; },
    getProviderMetrics() { return providerMetrics; },
    getRoutingEngine() { return routingEngine; },
    getFraudEngine() { return fraudEngine; },
    getTokenVault() { return tokenVault; },
    getFxService() { return fxService; },
    getRetryStrategy() { return retryStrategy; },
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

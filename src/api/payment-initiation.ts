import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import type { PaymentRequest, PaymentState } from "../core/types.js";
import type { Logger } from "../core/logger.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";
import type { ProviderRegistry } from "../routing/provider-registry.js";
import type { RoutingEngine } from "../routing/routing-engine.js";
import type { FxService, FxConversion } from "../fx/fx-service.js";
import type { FraudContext } from "../fraud/fraud-engine.js";
import { SNAPSHOT_THRESHOLD } from "../events/snapshot-store.js";
import { PaymentServiceError } from "./payment-service.js";
import type { TenantServices } from "./tenant-services.js";

export interface InitiationDeps {
  prisma: PrismaClient;
  logger: Logger;
  metrics: MetricsCollector;
  getTenantServices(tenantId: string): TenantServices;
  deriveState(tenantId: string, paymentId: string): Promise<Result<PaymentState, PaymentServiceError>>;
  defaultRoutingEngine: RoutingEngine;
  providerRegistry: ProviderRegistry;
  fxService: FxService;
}

export async function buildFraudContext(
  tenantId: string,
  request: PaymentRequest,
  prisma: PrismaClient,
  logger: Logger,
): Promise<FraudContext> {
  const oneHourAgo = new Date(Date.now() - 3600_000);
  let customerPaymentCount = 0;
  let totalAmount = 0;

  try {
    const recentEvents = await prisma.eventStore.findMany({
      where: {
        tenantId,
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
  } catch (e) {
    logger.warn("fraud_context_build_failed", {
      tenantId,
      customerId: request.customerId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return {
    customerPaymentCount,
    customerAvgAmount: customerPaymentCount > 0 ? Math.round(totalAmount / customerPaymentCount) : 0,
    customerRegion: request.region ?? "US",
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

export async function initiatePayment(
  tenantId: string,
  request: PaymentRequest,
  deps: InitiationDeps,
): Promise<Result<PaymentState, PaymentServiceError>> {
  const validation = validateRequest(request);
  if (!validation.ok) return validation;
  const {
    prisma,
    logger,
    metrics,
    getTenantServices,
    deriveState,
    defaultRoutingEngine,
    providerRegistry,
    fxService,
  } = deps;

  const {
    eventStore,
    snapshotStore,
    webhookService,
    sagaOrchestrator,
    fraudEngine,
    tokenVault,
    ledgerService,
  } = getTenantServices(tenantId);

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
  const fraudContext = await buildFraudContext(tenantId, request, prisma, logger);
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
  let fxConversion: FxConversion | undefined;
  const routeDecision = await defaultRoutingEngine.selectProvider({
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
      tenantId,
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

  const sagaContext = {
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
    logger.info("payment_completed", {
      paymentId,
      durationMs,
      providerId: sagaResult.value.context.providerId,
    });
    await webhookService.dispatch("payment.completed", {
      paymentId,
      providerId: sagaResult.value.context.providerId,
    });

    // Post double-entry ledger transaction for the captured payment.
    const ledgerResult = await ledgerService.postPaymentCaptured(
      paymentId,
      request.amount,
      request.currency,
    );
    if (ledgerResult.ok) {
      metrics.increment("ledger_entries_posted");
    } else {
      logger.warn("ledger_post_failed", { paymentId, error: ledgerResult.error.message });
    }
  }

  const stateResult = await deriveState(tenantId, paymentId);
  if (!stateResult.ok) return stateResult;

  const events = await eventStore.getByAggregateId(paymentId);
  if (events.ok && events.value.length >= SNAPSHOT_THRESHOLD) {
    await snapshotStore.save(paymentId, "Payment", events.value.length, stateResult.value);
  }

  return stateResult;
}

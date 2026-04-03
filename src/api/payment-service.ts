import type { PrismaClient } from "@prisma/client";
import { type Result, ok, err } from "../core/result.js";
import type { PaymentRequest, PaymentState, DomainEvent } from "../core/types.js";
import type { Logger } from "../core/logger.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";
import { fullPaymentReducer, initialPaymentState } from "../events/payment-projection.js";
import { createCircuitBreakerRegistry, type CircuitBreakerRegistry } from "../circuit-breaker/circuit-breaker-registry.js";
import { createBulkhead, type Bulkhead } from "../bulkhead/bulkhead.js";
import { createInventoryService } from "../external-services/inventory-service.js";
import { createNotificationService } from "../external-services/notification-service.js";
import { createStripeProvider } from "../external-services/stripe-provider.js";
import { createAdyenProvider } from "../external-services/adyen-provider.js";
import { createPayPalProvider } from "../external-services/paypal-provider.js";
import type { WebhookDeliveryService } from "../webhooks/webhook-delivery.js";
import { createProviderRegistry, type ProviderRegistry } from "../routing/provider-registry.js";
import { createProviderMetrics, type ProviderMetrics } from "../routing/provider-metrics.js";
import { createRoutingEngine, type RoutingEngine } from "../routing/routing-engine.js";
import { createRetryStrategy, type RetryStrategy } from "../retry/retry-strategy.js";
import type { FraudEngine } from "../fraud/fraud-engine.js";
import type { TokenVault } from "../tokenization/token-vault.js";
import { createFxService, type FxService } from "../fx/fx-service.js";
import type { LedgerService } from "../ledger/ledger-service.js";
import type { SettlementService } from "../settlement/settlement-service.js";
import type { SubscriptionService } from "../subscription/subscription-service.js";
import type { BillingEngine } from "../billing/billing-engine.js";
import type { DunningService } from "../billing/dunning-service.js";
import type { DisputeService } from "../dispute/dispute-service.js";
import type { SplitPaymentService } from "../split/split-payment-service.js";
import type { PayoutService } from "../payout/payout-service.js";
import type { AnalyticsService } from "../analytics/analytics-service.js";
import type { ReportService } from "../reporting/report-service.js";
import type { ExperimentService } from "../experiments/experiment-service.js";
import type { ThreeDSecureService } from "../three-d-secure/three-d-secure-service.js";
import type { PaymentMethodService } from "../payment-methods/payment-method-service.js";
import type { CheckoutService } from "../checkout/checkout-service.js";
import type { SandboxService } from "../sandbox/sandbox-service.js";
import { createWebhookCatalog, type WebhookCatalog } from "../webhook-catalog/webhook-catalog.js";
import type { ChaosController } from "../chaos/chaos-controller.js";
import type { AppConfig } from "../core/config.js";
import { createTenantServicesFactory } from "./tenant-services.js";
import {
  initiatePayment as doInitiatePayment,
} from "./payment-initiation.js";
import {
  getPayment as doGetPayment,
  getPaymentAt as doGetPaymentAt,
  replayPayment as doReplayPayment,
  listPayments as doListPayments,
  getPaymentEvents as doGetPaymentEvents,
} from "./payment-queries.js";

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
  initiatePayment(tenantId: string, request: PaymentRequest): Promise<Result<PaymentState, PaymentServiceError>>;
  getPayment(tenantId: string, paymentId: string): Promise<Result<PaymentState, PaymentServiceError>>;
  getPaymentAt(tenantId: string, paymentId: string, at: Date): Promise<Result<PaymentState, PaymentServiceError>>;
  replayPayment(tenantId: string, paymentId: string): Promise<Result<PaymentState, PaymentServiceError>>;
  listPayments(tenantId: string, limit: number, offset: number): Promise<Result<PaymentListResult, PaymentServiceError>>;
  getPaymentEvents(tenantId: string, paymentId: string): Promise<Result<DomainEvent[], PaymentServiceError>>;
  getWebhookService(tenantId: string): WebhookDeliveryService;
  getCircuitBreakerRegistry(): CircuitBreakerRegistry;
  getBulkheads(): Bulkhead[];
  getProviderRegistry(): ProviderRegistry;
  getProviderMetrics(tenantId: string): ProviderMetrics;
  getRoutingEngine(): RoutingEngine;
  getFraudEngine(tenantId: string): FraudEngine;
  getTokenVault(tenantId: string): TokenVault;
  getFxService(): FxService;
  getRetryStrategy(): RetryStrategy;
  getLedgerService(tenantId: string): LedgerService;
  getSettlementService(tenantId: string): SettlementService;
  getSubscriptionService(tenantId: string): SubscriptionService;
  getBillingEngine(tenantId: string): BillingEngine;
  getDunningService(tenantId: string): DunningService;
  getDisputeService(tenantId: string): DisputeService;
  getSplitPaymentService(tenantId: string): SplitPaymentService;
  getPayoutService(tenantId: string): PayoutService;
  getAnalyticsService(tenantId: string): AnalyticsService;
  getReportService(tenantId: string): ReportService;
  getExperimentService(tenantId: string): ExperimentService;
  getThreeDSecureService(tenantId: string): ThreeDSecureService;
  getPaymentMethodService(tenantId: string): PaymentMethodService;
  getCheckoutService(tenantId: string): CheckoutService;
  getSandboxService(tenantId: string): SandboxService;
  getWebhookCatalog(): WebhookCatalog;
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

  // ── Shared (tenant-agnostic) infrastructure ─────────────────────────────

  const webhookCatalog = createWebhookCatalog();
  const cbRegistry = createCircuitBreakerRegistry();

  cbRegistry.create({ name: "stripe", failureThreshold: config.circuitBreakerFailureThreshold, timeoutMs: config.circuitBreakerTimeoutMs });
  cbRegistry.create({ name: "adyen", failureThreshold: config.circuitBreakerFailureThreshold, timeoutMs: config.circuitBreakerTimeoutMs });
  cbRegistry.create({ name: "paypal", failureThreshold: config.circuitBreakerFailureThreshold, timeoutMs: config.circuitBreakerTimeoutMs });

  const inventoryCb = cbRegistry.create({ name: "inventory-service", failureThreshold: config.circuitBreakerFailureThreshold, timeoutMs: config.circuitBreakerTimeoutMs });
  const notificationCb = cbRegistry.create({ name: "notification-service", failureThreshold: config.circuitBreakerFailureThreshold, timeoutMs: config.circuitBreakerTimeoutMs });

  const paymentBulkhead = createBulkhead({ name: "payment-providers", maxConcurrent: 10, maxQueue: 20 });
  const inventoryBulkhead = createBulkhead({ name: "inventory-service", maxConcurrent: 15, maxQueue: 30 });
  const notificationBulkhead = createBulkhead({ name: "notification-service", maxConcurrent: 20, maxQueue: 40 });

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

  const retryStrategy = createRetryStrategy();
  const inventoryService = createInventoryService(chaos);
  const notificationService = createNotificationService(chaos);
  const fxService = createFxService();

  // ── Tenant-scoped service cache ──────────────────────────────────────────

  const tenantServicesFactory = createTenantServicesFactory({
    prisma,
    webhookSecret: config.webhookSecret,
    cbRegistry,
    inventoryCb,
    notificationCb,
    providerRegistry,
    inventoryService,
    notificationService,
    retryStrategy,
    logger,
  });

  const getTenantServices = (tenantId: string) => tenantServicesFactory.get(tenantId);

  // ── Shared routing engine ────────────────────────────────────────────────
  // Uses a default tenant metrics store for routing decisions. Per-tenant
  // accuracy is available via getProviderMetrics(tenantId).

  const defaultRoutingEngine = createRoutingEngine({
    registry: providerRegistry,
    cbRegistry,
    metrics: createProviderMetrics(prisma, "default"),
    logger,
  });

  // ── State derivation (shared by initiation and query modules) ────────────

  async function deriveState(tenantId: string, paymentId: string): Promise<Result<PaymentState, PaymentServiceError>> {
    const { eventStore, snapshotStore } = getTenantServices(tenantId);
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

  const queryDeps = { getTenantServices, deriveState };

  const initiationDeps = {
    prisma,
    logger,
    metrics,
    getTenantServices,
    deriveState,
    defaultRoutingEngine,
    providerRegistry,
    fxService,
  };

  return {
    initiatePayment(tenantId, request) {
      return doInitiatePayment(tenantId, request, initiationDeps);
    },

    getPayment(tenantId, paymentId) {
      return doGetPayment(tenantId, paymentId, queryDeps);
    },

    getPaymentAt(tenantId, paymentId, at) {
      return doGetPaymentAt(tenantId, paymentId, at, queryDeps);
    },

    replayPayment(tenantId, paymentId) {
      return doReplayPayment(tenantId, paymentId, queryDeps);
    },

    listPayments(tenantId, limit, offset) {
      return doListPayments(tenantId, limit, offset, queryDeps);
    },

    getPaymentEvents(tenantId, paymentId) {
      return doGetPaymentEvents(tenantId, paymentId, queryDeps);
    },

    getWebhookService(tenantId) { return getTenantServices(tenantId).webhookService; },
    getCircuitBreakerRegistry() { return cbRegistry; },
    getBulkheads() { return [paymentBulkhead, inventoryBulkhead, notificationBulkhead]; },
    getProviderRegistry() { return providerRegistry; },
    getProviderMetrics(tenantId) { return getTenantServices(tenantId).providerMetrics; },
    getRoutingEngine() { return defaultRoutingEngine; },
    getFraudEngine(tenantId) { return getTenantServices(tenantId).fraudEngine; },
    getTokenVault(tenantId) { return getTenantServices(tenantId).tokenVault; },
    getFxService() { return fxService; },
    getRetryStrategy() { return retryStrategy; },
    getLedgerService(tenantId) { return getTenantServices(tenantId).ledgerService; },
    getSettlementService(tenantId) { return getTenantServices(tenantId).settlementService; },
    getSubscriptionService(tenantId) { return getTenantServices(tenantId).subscriptionService; },
    getBillingEngine(tenantId) { return getTenantServices(tenantId).billingEngine; },
    getDunningService(tenantId) { return getTenantServices(tenantId).dunningService; },
    getDisputeService(tenantId) { return getTenantServices(tenantId).disputeService; },
    getSplitPaymentService(tenantId) { return getTenantServices(tenantId).splitPaymentService; },
    getPayoutService(tenantId) { return getTenantServices(tenantId).payoutService; },
    getAnalyticsService(tenantId) { return getTenantServices(tenantId).analyticsService; },
    getReportService(tenantId) { return getTenantServices(tenantId).reportService; },
    getExperimentService(tenantId) { return getTenantServices(tenantId).experimentService; },
    getThreeDSecureService(tenantId) { return getTenantServices(tenantId).threeDSecureService; },
    getPaymentMethodService(tenantId) { return getTenantServices(tenantId).paymentMethodService; },
    getCheckoutService(tenantId) { return getTenantServices(tenantId).checkoutService; },
    getSandboxService(tenantId) { return getTenantServices(tenantId).sandboxService; },
    getWebhookCatalog() { return webhookCatalog; },
  };
}


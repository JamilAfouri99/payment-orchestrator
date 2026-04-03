import type { PrismaClient } from "@prisma/client";
import { createEventStore } from "../events/event-store.js";
import { createSnapshotStore } from "../events/snapshot-store.js";
import type { PaymentState } from "../core/types.js";
import { createSagaOrchestrator } from "../saga/saga-orchestrator.js";
import { createPaymentSagaSteps, type PaymentSagaContext } from "../saga/payment-saga.js";
import { createWebhookDeliveryService, type WebhookDeliveryService } from "../webhooks/webhook-delivery.js";
import { createProviderMetrics, type ProviderMetrics } from "../routing/provider-metrics.js";
import { createRoutingEngine } from "../routing/routing-engine.js";
import type { CircuitBreakerRegistry } from "../circuit-breaker/circuit-breaker-registry.js";
import type { CircuitBreaker } from "../circuit-breaker/circuit-breaker.js";
import type { ProviderRegistry } from "../routing/provider-registry.js";
import { createFraudEngine, type FraudEngine } from "../fraud/fraud-engine.js";
import { createTokenVault, type TokenVault } from "../tokenization/token-vault.js";
import { createLedgerService, type LedgerService } from "../ledger/ledger-service.js";
import { createSettlementService, type SettlementService } from "../settlement/settlement-service.js";
import { createSubscriptionService, type SubscriptionService } from "../subscription/subscription-service.js";
import { createBillingEngine, type BillingEngine } from "../billing/billing-engine.js";
import { createDunningService, type DunningService } from "../billing/dunning-service.js";
import { createDisputeService, type DisputeService } from "../dispute/dispute-service.js";
import { createSplitPaymentService, type SplitPaymentService } from "../split/split-payment-service.js";
import { createPayoutService, type PayoutService } from "../payout/payout-service.js";
import { createAnalyticsService, type AnalyticsService } from "../analytics/analytics-service.js";
import { createReportService, type ReportService } from "../reporting/report-service.js";
import { createExperimentService, type ExperimentService } from "../experiments/experiment-service.js";
import { createThreeDSecureService, type ThreeDSecureService } from "../three-d-secure/three-d-secure-service.js";
import { createPaymentMethodService, type PaymentMethodService } from "../payment-methods/payment-method-service.js";
import { createCheckoutService, type CheckoutService } from "../checkout/checkout-service.js";
import { createSandboxService, type SandboxService } from "../sandbox/sandbox-service.js";
import type { InventoryService } from "../external-services/inventory-service.js";
import type { NotificationService } from "../external-services/notification-service.js";
import type { RetryStrategy } from "../retry/retry-strategy.js";
import type { Logger } from "../core/logger.js";

/** All DB-backed services scoped to a single tenant, created once and cached. */
export interface TenantServices {
  eventStore: ReturnType<typeof createEventStore>;
  snapshotStore: ReturnType<typeof createSnapshotStore<PaymentState>>;
  webhookService: WebhookDeliveryService;
  providerMetrics: ProviderMetrics;
  sagaOrchestrator: ReturnType<typeof createSagaOrchestrator<PaymentSagaContext>>;
  fraudEngine: FraudEngine;
  tokenVault: TokenVault;
  ledgerService: LedgerService;
  settlementService: SettlementService;
  subscriptionService: SubscriptionService;
  billingEngine: BillingEngine;
  dunningService: DunningService;
  disputeService: DisputeService;
  splitPaymentService: SplitPaymentService;
  payoutService: PayoutService;
  analyticsService: AnalyticsService;
  reportService: ReportService;
  experimentService: ExperimentService;
  threeDSecureService: ThreeDSecureService;
  paymentMethodService: PaymentMethodService;
  checkoutService: CheckoutService;
  sandboxService: SandboxService;
}

export interface TenantServicesFactoryDeps {
  prisma: PrismaClient;
  webhookSecret: string;
  cbRegistry: CircuitBreakerRegistry;
  inventoryCb: CircuitBreaker;
  notificationCb: CircuitBreaker;
  providerRegistry: ProviderRegistry;
  inventoryService: InventoryService;
  notificationService: NotificationService;
  retryStrategy: RetryStrategy;
  logger: Logger;
}

export interface TenantServicesFactory {
  get(tenantId: string): TenantServices;
}

export function createTenantServicesFactory(deps: TenantServicesFactoryDeps): TenantServicesFactory {
  const {
    prisma,
    webhookSecret,
    cbRegistry,
    inventoryCb,
    notificationCb,
    providerRegistry,
    inventoryService,
    notificationService,
    retryStrategy,
    logger,
  } = deps;

  const cache = new Map<string, TenantServices>();

  function build(tenantId: string): TenantServices {
    const eventStore = createEventStore(prisma, tenantId);
    const snapshotStore = createSnapshotStore<PaymentState>(prisma, tenantId);
    const webhookService = createWebhookDeliveryService(prisma, webhookSecret, tenantId);
    const providerMetrics = createProviderMetrics(prisma, tenantId);

    const routingEngine = createRoutingEngine({
      registry: providerRegistry,
      cbRegistry,
      metrics: providerMetrics,
      logger,
    });

    const sagaSteps = createPaymentSagaSteps({
      eventStore,
      inventoryCb,
      notificationCb,
      inventoryService,
      notificationService,
      routingEngine,
      retryStrategy,
    });

    const sagaOrchestrator = createSagaOrchestrator(prisma, "payment", sagaSteps, tenantId);
    const fraudEngine = createFraudEngine(prisma, tenantId);
    const tokenVault = createTokenVault(prisma, tenantId);
    const ledgerService = createLedgerService(prisma, tenantId);
    const settlementService = createSettlementService(prisma, tenantId, ledgerService);
    const subscriptionService = createSubscriptionService(prisma, tenantId, eventStore, ledgerService);
    const billingEngine = createBillingEngine(prisma, tenantId, subscriptionService, ledgerService, eventStore);
    const dunningService = createDunningService(prisma, tenantId, billingEngine, subscriptionService, eventStore);
    const disputeService = createDisputeService(prisma, tenantId, ledgerService, eventStore, webhookService);
    const splitPaymentService = createSplitPaymentService(prisma, tenantId, ledgerService, eventStore, webhookService);
    const payoutService = createPayoutService(prisma, tenantId, ledgerService, eventStore, webhookService);
    const analyticsService = createAnalyticsService(prisma, tenantId);
    const reportService = createReportService(prisma, tenantId, eventStore);
    const experimentService = createExperimentService(prisma, tenantId, eventStore);
    const threeDSecureService = createThreeDSecureService(prisma, tenantId);
    const paymentMethodService = createPaymentMethodService(prisma, tenantId);
    const checkoutService = createCheckoutService(prisma, tenantId);
    const sandboxService = createSandboxService(prisma, tenantId);

    // Fire-and-forget: seed system ledger accounts on first tenant access.
    ledgerService.ensureSystemAccounts().catch((e) => {
      logger.warn("ledger_system_accounts_init_failed", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
    });

    return {
      eventStore,
      snapshotStore,
      webhookService,
      providerMetrics,
      sagaOrchestrator,
      fraudEngine,
      tokenVault,
      ledgerService,
      settlementService,
      subscriptionService,
      billingEngine,
      dunningService,
      disputeService,
      splitPaymentService,
      payoutService,
      analyticsService,
      reportService,
      experimentService,
      threeDSecureService,
      paymentMethodService,
      checkoutService,
      sandboxService,
    };
  }

  return {
    get(tenantId: string): TenantServices {
      const cached = cache.get(tenantId);
      if (cached !== undefined) return cached;
      const services = build(tenantId);
      cache.set(tenantId, services);
      return services;
    },
  };
}

import { Router } from "express";
import type { ChaosController } from "../chaos/chaos-controller.js";
import type { CircuitBreakerRegistry } from "../circuit-breaker/circuit-breaker-registry.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";
import type { Logger } from "../core/logger.js";
import type { Bulkhead } from "../bulkhead/bulkhead.js";
import type { PrismaClient } from "@prisma/client";
import type { ProviderRegistry } from "../routing/provider-registry.js";
import type { RoutingEngine } from "../routing/routing-engine.js";
import type { FxService } from "../fx/fx-service.js";
import type { RetryStrategy } from "../retry/retry-strategy.js";
import type { PaymentService } from "./payment-service.js";
import type { QueueService } from "../queue/queue-service.js";
import { registerChaosRoutes } from "./admin/chaos-routes.js";
import { registerCircuitBreakerRoutes } from "./admin/circuit-breaker-routes.js";
import { registerObservabilityRoutes } from "./admin/observability-routes.js";
import { registerProviderRoutes } from "./admin/provider-routes.js";
import { registerFraudRoutes } from "./admin/fraud-routes.js";
import { registerTokenRoutes } from "./admin/token-routes.js";
import { registerFxRoutes } from "./admin/fx-routes.js";
import { registerLedgerRoutes } from "./admin/ledger-routes.js";
import { registerSettlementRoutes } from "./admin/settlement-routes.js";
import { registerPlanRoutes } from "./admin/plan-routes.js";
import { registerSubscriptionRoutes } from "./admin/subscription-routes.js";
import { registerBillingRoutes } from "./admin/billing-routes.js";
import { registerDisputeRoutes } from "./admin/dispute-routes.js";
import { registerSplitPaymentRoutes } from "./admin/split-payment-routes.js";
import { registerPayoutAccountRoutes } from "./admin/payout-account-routes.js";
import { registerPayoutRoutes } from "./admin/payout-routes.js";
import { registerAnalyticsRoutes } from "./admin/analytics-routes.js";
import { registerReportRoutes } from "./admin/report-routes.js";
import { registerExperimentRoutes } from "./admin/experiment-routes.js";
import { registerThreeDSecureRoutes } from "./admin/three-d-secure-routes.js";
import { registerCheckoutRoutes } from "./admin/checkout-routes.js";
import { registerSandboxRoutes } from "./admin/sandbox-routes.js";
import { registerQueueRoutes } from "./admin/queue-routes.js";
import { registerWebhookAdminRoutes } from "./admin/webhook-routes.js";

export interface AdminRouteDeps {
  chaos: ChaosController;
  cbRegistry: CircuitBreakerRegistry;
  metrics: MetricsCollector;
  logger: Logger;
  bulkheads: Bulkhead[];
  prisma: PrismaClient;
  webhookSecret: string;
  providerRegistry: ProviderRegistry;
  routingEngine: RoutingEngine;
  fxService: FxService;
  retryStrategy: RetryStrategy;
  paymentService: PaymentService;
  queueService?: QueueService | undefined;
}

export function createAdminRoutes(deps: AdminRouteDeps): Router {
  const router = Router();

  registerChaosRoutes(router, deps);
  registerCircuitBreakerRoutes(router, deps);
  registerObservabilityRoutes(router, deps);
  registerProviderRoutes(router, deps);
  registerFraudRoutes(router, deps);
  registerTokenRoutes(router, deps);
  registerFxRoutes(router, deps);
  registerLedgerRoutes(router, deps);
  registerSettlementRoutes(router, deps);
  registerPlanRoutes(router, deps);
  registerSubscriptionRoutes(router, deps);
  registerBillingRoutes(router, deps);
  registerDisputeRoutes(router, deps);
  registerSplitPaymentRoutes(router, deps);
  registerPayoutAccountRoutes(router, deps);
  registerPayoutRoutes(router, deps);
  registerAnalyticsRoutes(router, deps);
  registerReportRoutes(router, deps);
  registerExperimentRoutes(router, deps);
  registerThreeDSecureRoutes(router, deps);
  registerCheckoutRoutes(router, deps);
  registerSandboxRoutes(router, deps);
  registerQueueRoutes(router, deps);
  registerWebhookAdminRoutes(router, deps);

  return router;
}

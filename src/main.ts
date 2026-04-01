import express from "express";
import { loadConfig } from "./core/config.js";
import { createLogger } from "./core/logger.js";
import { correlationMiddleware } from "./core/correlation.js";
import { getPrisma, disconnectPrisma } from "./core/database.js";
import { createChaosController } from "./chaos/chaos-controller.js";
import { createMetricsCollector } from "./metrics/metrics-collector.js";
import { requestLoggerMiddleware } from "./middleware/request-logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createPaymentService } from "./api/payment-service.js";
import { createRoutes } from "./api/routes.js";
import { createAdminRoutes } from "./api/admin-routes.js";
import { createAuthRoutes } from "./api/auth-routes.js";
import { createWebhookScheduler } from "./webhooks/webhook-scheduler.js";
import { recoverIncompleteSagas } from "./saga/saga-recovery.js";
import { seedDefaultFraudRules } from "./fraud/seed-rules.js";
import { createGraphQLHandler } from "./graphql/yoga-server.js";
import { createPubSub } from "./graphql/subscriptions.js";
import { DEFAULT_TENANT_ID } from "./tenancy/tenant-context.js";
import { createSessionService } from "./auth/session-service.js";
import { createApiKeyService } from "./auth/api-key-service.js";
import { createApiKeyAuthMiddleware } from "./auth/api-key-middleware.js";
import { createOnboardingService } from "./auth/onboarding-service.js";
import { createTeamService } from "./auth/team-service.js";
import { createTenantService } from "./tenancy/tenant-service.js";

const config = loadConfig();
const logger = createLogger({ service: "payment-orchestrator" });
const metrics = createMetricsCollector();
const prisma = getPrisma();

const chaos = createChaosController({
  "stripe": { failureRate: config.paymentProviderFailureRate, enabled: true },
  "adyen": { failureRate: config.paymentProviderFailureRate, enabled: true },
  "paypal": { failureRate: config.paymentProviderFailureRate, enabled: true },
  "inventory-service": { failureRate: config.inventoryServiceFailureRate, enabled: true },
  "notification-service": { failureRate: config.notificationServiceFailureRate, enabled: true },
});

const paymentService = createPaymentService({ prisma, config, chaos, logger, metrics });

const tenantService = createTenantService(prisma);
const sessionService = createSessionService(prisma, config.jwtSecret);
const apiKeyService = createApiKeyService(prisma);
const onboardingService = createOnboardingService({ prisma, tenantService, sessionService, apiKeyService, logger });
const teamService = createTeamService(prisma, logger);

const app = express();
app.use(express.json());
app.use(correlationMiddleware);
app.use(requestLoggerMiddleware(logger, metrics));

// Auth routes handle their own per-endpoint authentication; mounted before the
// API key middleware so that register, login, and invite-accept remain public.
const authRoutes = createAuthRoutes({ prisma, sessionService, apiKeyService, onboardingService, teamService, logger });
app.use(authRoutes);

// Everything below this point requires a valid API key (or dev bypass).
const apiKeyAuth = createApiKeyAuthMiddleware({ prisma, apiKeyService, logger });
app.use(apiKeyAuth);

const routes = createRoutes({
  paymentService,
  prisma,
  idempotencyTtlMs: config.idempotencyTtlMs,
  metrics,
});

const adminRoutes = createAdminRoutes({
  chaos,
  cbRegistry: paymentService.getCircuitBreakerRegistry(),
  metrics,
  logger,
  bulkheads: paymentService.getBulkheads(),
  prisma,
  webhookSecret: config.webhookSecret,
  providerRegistry: paymentService.getProviderRegistry(),
  routingEngine: paymentService.getRoutingEngine(),
  fxService: paymentService.getFxService(),
  retryStrategy: paymentService.getRetryStrategy(),
  paymentService,
});

app.use(routes);
app.use(adminRoutes);

const pubsub = createPubSub();
const graphql = createGraphQLHandler({
  paymentService,
  chaos,
  metrics,
  pubsub,
});
app.use("/graphql", graphql as unknown as import("express").RequestHandler);

app.use(errorHandler);

const webhookScheduler = createWebhookScheduler(
  paymentService.getWebhookService(DEFAULT_TENANT_ID),
  logger,
  metrics,
  5000,
);

const server = app.listen(config.port, () => {
  logger.info("server_started", { port: config.port, env: config.nodeEnv });

  recoverIncompleteSagas(prisma, logger).catch((e) => {
    logger.error("saga_recovery_failed", { error: e instanceof Error ? e.message : String(e) });
  });

  seedDefaultFraudRules(prisma, logger, DEFAULT_TENANT_ID).catch((e) => {
    logger.error("fraud_seed_failed", { error: e instanceof Error ? e.message : String(e) });
  });

  webhookScheduler.start();
});

async function shutdown(): Promise<void> {
  logger.info("shutdown_initiated");
  webhookScheduler.stop();
  server.close();
  await disconnectPrisma();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

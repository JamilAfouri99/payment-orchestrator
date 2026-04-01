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
import { createWebhookScheduler } from "./webhooks/webhook-scheduler.js";
import { recoverIncompleteSagas } from "./saga/saga-recovery.js";

const config = loadConfig();
const logger = createLogger({ service: "payment-orchestrator" });
const metrics = createMetricsCollector();
const prisma = getPrisma();

const chaos = createChaosController({
  "payment-provider": { failureRate: config.paymentProviderFailureRate, enabled: true },
  "inventory-service": { failureRate: config.inventoryServiceFailureRate, enabled: true },
  "notification-service": { failureRate: config.notificationServiceFailureRate, enabled: true },
});

const paymentService = createPaymentService({ prisma, config, chaos, logger, metrics });

const app = express();
app.use(express.json());
app.use(correlationMiddleware);
app.use(requestLoggerMiddleware(logger, metrics));

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
});

app.use(routes);
app.use(adminRoutes);
app.use(errorHandler);

const webhookScheduler = createWebhookScheduler(
  paymentService.getWebhookService(),
  logger,
  metrics,
  5000,
);

const server = app.listen(config.port, () => {
  logger.info("server_started", { port: config.port, env: config.nodeEnv });

  recoverIncompleteSagas(prisma, logger).catch((err) => {
    logger.error("saga_recovery_failed", { error: err instanceof Error ? err.message : String(err) });
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

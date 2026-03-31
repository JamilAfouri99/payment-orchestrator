import express from "express";
import { loadConfig } from "./core/config.js";
import { getPrisma, disconnectPrisma } from "./core/database.js";
import { createPaymentService } from "./api/payment-service.js";
import { createRoutes } from "./api/routes.js";
import { errorHandler } from "./middleware/error-handler.js";

const config = loadConfig();
const prisma = getPrisma();
const paymentService = createPaymentService(prisma, config);

const app = express();
app.use(express.json());

const routes = createRoutes(paymentService, prisma, config.idempotencyTtlMs);
app.use(routes);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`Payment orchestrator running on port ${config.port} [${config.nodeEnv}]`); // eslint-disable-line no-console
});

async function shutdown(): Promise<void> {
  console.log("Shutting down gracefully..."); // eslint-disable-line no-console
  server.close();
  await disconnectPrisma();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

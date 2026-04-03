export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  webhookSecret: string;
  jwtSecret: string;
  redisUrl: string;
  cacheEnabled: boolean;
  queueConcurrencyDefault: number;
  paymentProviderFailureRate: number;
  inventoryServiceFailureRate: number;
  notificationServiceFailureRate: number;
  circuitBreakerFailureThreshold: number;
  circuitBreakerTimeoutMs: number;
  idempotencyTtlMs: number;
}

/**
 * Loads configuration from environment variables with sensible defaults.
 * @returns Fully resolved application config
 */
export function loadConfig(): AppConfig {
  const nodeEnv = process.env["NODE_ENV"] ?? "development";
  const jwtSecret = process.env["JWT_SECRET"] ?? "dev-jwt-secret-change-in-production";
  const webhookSecret = process.env["WEBHOOK_SECRET"] ?? "dev-webhook-secret";

  if (nodeEnv === "production") {
    if (jwtSecret === "dev-jwt-secret-change-in-production") {
      throw new Error("JWT_SECRET must be set in production — do not use the default value");
    }
    if (webhookSecret === "dev-webhook-secret") {
      throw new Error("WEBHOOK_SECRET must be set in production — do not use the default value");
    }
  }

  return {
    port: parseInt(process.env["PORT"] ?? "3000", 10),
    nodeEnv,
    databaseUrl: process.env["DATABASE_URL"] ?? "postgresql://payment_user:payment_pass@localhost:5432/payment_orchestrator",
    webhookSecret,
    jwtSecret,
    redisUrl: process.env["REDIS_URL"] ?? "redis://localhost:6379",
    cacheEnabled: process.env["CACHE_ENABLED"] !== "false",
    queueConcurrencyDefault: parseInt(process.env["QUEUE_CONCURRENCY_DEFAULT"] ?? "5", 10),
    paymentProviderFailureRate: parseFloat(process.env["PAYMENT_PROVIDER_FAILURE_RATE"] ?? "0.1"),
    inventoryServiceFailureRate: parseFloat(process.env["INVENTORY_SERVICE_FAILURE_RATE"] ?? "0.05"),
    notificationServiceFailureRate: parseFloat(process.env["NOTIFICATION_SERVICE_FAILURE_RATE"] ?? "0.05"),
    circuitBreakerFailureThreshold: parseInt(process.env["CIRCUIT_BREAKER_FAILURE_THRESHOLD"] ?? "5", 10),
    circuitBreakerTimeoutMs: parseInt(process.env["CIRCUIT_BREAKER_TIMEOUT_MS"] ?? "30000", 10),
    idempotencyTtlMs: parseInt(process.env["IDEMPOTENCY_TTL_MS"] ?? "86400000", 10),
  };
}

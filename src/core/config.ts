export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  webhookSecret: string;
  jwtSecret: string;
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
  return {
    port: parseInt(process.env["PORT"] ?? "3000", 10),
    nodeEnv: process.env["NODE_ENV"] ?? "development",
    databaseUrl: process.env["DATABASE_URL"] ?? "postgresql://payment_user:payment_pass@localhost:5432/payment_orchestrator",
    webhookSecret: process.env["WEBHOOK_SECRET"] ?? "dev-webhook-secret",
    jwtSecret: process.env["JWT_SECRET"] ?? "dev-jwt-secret-change-in-production",
    paymentProviderFailureRate: parseFloat(process.env["PAYMENT_PROVIDER_FAILURE_RATE"] ?? "0.1"),
    inventoryServiceFailureRate: parseFloat(process.env["INVENTORY_SERVICE_FAILURE_RATE"] ?? "0.05"),
    notificationServiceFailureRate: parseFloat(process.env["NOTIFICATION_SERVICE_FAILURE_RATE"] ?? "0.05"),
    circuitBreakerFailureThreshold: parseInt(process.env["CIRCUIT_BREAKER_FAILURE_THRESHOLD"] ?? "5", 10),
    circuitBreakerTimeoutMs: parseInt(process.env["CIRCUIT_BREAKER_TIMEOUT_MS"] ?? "30000", 10),
    idempotencyTtlMs: parseInt(process.env["IDEMPOTENCY_TTL_MS"] ?? "86400000", 10),
  };
}

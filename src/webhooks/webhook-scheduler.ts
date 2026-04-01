import type { WebhookDeliveryService } from "./webhook-delivery.js";
import type { Logger } from "../core/logger.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";

export interface WebhookScheduler {
  /** Starts the periodic retry processor */
  start(): void;
  /** Stops the scheduler */
  stop(): void;
  /** @returns Whether the scheduler is running */
  isRunning(): boolean;
  /** Runs one retry cycle manually */
  runOnce(): Promise<number>;
}

/**
 * Creates a scheduler that periodically processes webhook retries.
 * @param webhookService - The webhook delivery service
 * @param logger - Structured logger
 * @param metrics - Metrics collector
 * @param intervalMs - Interval between retry sweeps (default: 5000ms)
 * @returns WebhookScheduler instance
 */
export function createWebhookScheduler(
  webhookService: WebhookDeliveryService,
  logger: Logger,
  metrics: MetricsCollector,
  intervalMs: number = 5000,
): WebhookScheduler {
  let timer: ReturnType<typeof setInterval> | null = null;

  async function processRetries(): Promise<number> {
    const result = await webhookService.processRetries();
    if (!result.ok) {
      logger.error("webhook_scheduler", { error: result.error.message });
      return 0;
    }

    if (result.value > 0) {
      logger.info("webhook_scheduler", {
        message: `Processed ${result.value} webhook retries`,
        count: result.value,
      });
      metrics.increment("webhook_retries_processed", {}, result.value);
    }

    return result.value;
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        processRetries().catch((err) => {
          logger.error("webhook_scheduler", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, intervalMs);
      logger.info("webhook_scheduler", { message: "Started", intervalMs });
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        logger.info("webhook_scheduler", { message: "Stopped" });
      }
    },

    isRunning() {
      return timer !== null;
    },

    async runOnce() {
      return processRetries();
    },
  };
}

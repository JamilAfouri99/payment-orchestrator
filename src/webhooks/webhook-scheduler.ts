import type { WebhookDeliveryService } from "./webhook-delivery.js";
import type { Logger } from "../core/logger.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";
import type { QueueService } from "../queue/queue-service.js";

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
 *
 * When a QueueService is provided, delegates to BullMQ repeatable jobs.
 * When absent, falls back to setInterval for environments without Redis.
 */
export function createWebhookScheduler(
  webhookService: WebhookDeliveryService,
  logger: Logger,
  metrics: MetricsCollector,
  intervalMs: number = 5000,
  queueService?: QueueService | undefined,
): WebhookScheduler {
  let timer: ReturnType<typeof setInterval> | null = null;
  let bullmqActive = false;

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
      if (timer || bullmqActive) return;

      if (queueService) {
        // BullMQ mode: register a repeatable job
        queueService.addRepeatable(
          "webhook-delivery",
          "process-retries",
          { action: "process-retries" },
          intervalMs,
        ).then(() => {
          bullmqActive = true;
          logger.info("webhook_scheduler", { message: "Started (BullMQ mode)", intervalMs });
        }).catch((err) => {
          // Fallback to setInterval if BullMQ fails
          logger.error("webhook_scheduler", {
            message: "BullMQ failed, falling back to setInterval",
            error: err instanceof Error ? err.message : String(err),
          });
          startInterval();
        });
      } else {
        startInterval();
      }

      function startInterval(): void {
        timer = setInterval(() => {
          processRetries().catch((err) => {
            logger.error("webhook_scheduler", {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }, intervalMs);
        logger.info("webhook_scheduler", { message: "Started (interval mode)", intervalMs });
      }
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        logger.info("webhook_scheduler", { message: "Stopped (interval mode)" });
      }
      if (bullmqActive && queueService) {
        queueService.removeRepeatable("webhook-delivery", "process-retries", intervalMs).catch((err) => {
          logger.error("webhook_scheduler", {
            message: "Failed to remove repeatable job",
            error: err instanceof Error ? err.message : String(err),
          });
        });
        bullmqActive = false;
        logger.info("webhook_scheduler", { message: "Stopped (BullMQ mode)" });
      }
    },

    isRunning() {
      return timer !== null || bullmqActive;
    },

    async runOnce() {
      return processRetries();
    },
  };
}

import type { Job } from "bullmq";
import type { QueueService } from "../queue-service.js";
import type { PaymentService } from "../../api/payment-service.js";
import type { Logger } from "../../core/logger.js";
import type { MetricsCollector } from "../../metrics/metrics-collector.js";

export function registerWebhookWorker(
  queueService: QueueService,
  paymentService: PaymentService,
  defaultTenantId: string,
  logger: Logger,
  metrics: MetricsCollector,
): void {
  queueService.registerWorker("webhook-delivery", async (job: Job) => {
    const { action } = job.data as { action: string };

    if (action === "process-retries") {
      const tenantId = (job.data as { tenantId?: string }).tenantId ?? defaultTenantId;
      const webhookService = paymentService.getWebhookService(tenantId);
      const result = await webhookService.processRetries();

      if (!result.ok) {
        throw new Error(`Webhook retry processing failed: ${result.error.message}`);
      }

      if (result.value > 0) {
        logger.info("webhook_worker_retries", { count: result.value });
        metrics.increment("webhook_retries_processed", {}, result.value);
      }

      return { processed: result.value };
    }

    if (action === "deliver") {
      const { tenantId, eventType, payload } = job.data as {
        tenantId: string;
        eventType: string;
        payload: Record<string, unknown>;
      };

      const webhookService = paymentService.getWebhookService(tenantId);
      const result = await webhookService.dispatch(eventType, payload);

      if (!result.ok) {
        throw new Error(`Webhook delivery failed: ${result.error.message}`);
      }

      return { delivered: result.value };
    }

    throw new Error(`Unknown webhook worker action: ${action}`);
  });
}

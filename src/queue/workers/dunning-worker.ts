import type { Job } from "bullmq";
import type { QueueService } from "../queue-service.js";
import type { PaymentService } from "../../api/payment-service.js";
import type { Logger } from "../../core/logger.js";

export function registerDunningWorker(
  queueService: QueueService,
  paymentService: PaymentService,
  logger: Logger,
): void {
  queueService.registerWorker("dunning-retry", async (job: Job) => {
    const { action, tenantId } = job.data as { action: string; tenantId: string };

    const dunningService = paymentService.getDunningService(tenantId);

    if (action === "process-retries") {
      logger.info("dunning_worker_processing", { jobId: job.id, tenantId });

      const result = await dunningService.processRetries();
      if (!result.ok) {
        throw new Error(`Dunning retry processing failed: ${result.error.message}`);
      }

      return result.value;
    }

    if (action === "start-dunning") {
      const { invoiceId } = job.data as { invoiceId: string; tenantId: string; action: string };
      logger.info("dunning_worker_start", { jobId: job.id, tenantId, invoiceId });

      const result = await dunningService.startDunning(invoiceId);
      if (!result.ok) {
        throw new Error(`Start dunning failed: ${result.error.message}`);
      }

      return { invoiceId, started: true };
    }

    throw new Error(`Unknown dunning worker action: ${action}`);
  });
}

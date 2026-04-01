import type { Job } from "bullmq";
import type { QueueService } from "../queue-service.js";
import type { PaymentService } from "../../api/payment-service.js";
import type { Logger } from "../../core/logger.js";

export function registerPaymentWorker(
  queueService: QueueService,
  paymentService: PaymentService,
  logger: Logger,
): void {
  queueService.registerWorker("payment-processing", async (job: Job) => {
    const { tenantId, paymentRequest } = job.data as {
      tenantId: string;
      paymentRequest: import("../../core/types.js").PaymentRequest;
    };

    logger.info("payment_worker_processing", {
      jobId: job.id,
      tenantId,
      amount: paymentRequest.amount,
      currency: paymentRequest.currency,
    });

    await job.updateProgress(10);

    const result = await paymentService.initiatePayment(tenantId, paymentRequest);

    await job.updateProgress(100);

    if (!result.ok) {
      throw new Error(`Payment processing failed: ${result.error.message} (${result.error.code})`);
    }

    return { paymentId: result.value.id, status: result.value.status };
  });
}

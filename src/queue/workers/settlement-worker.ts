import type { Job } from "bullmq";
import type { QueueService } from "../queue-service.js";
import type { PaymentService } from "../../api/payment-service.js";
import type { Logger } from "../../core/logger.js";

export function registerSettlementWorker(
  queueService: QueueService,
  paymentService: PaymentService,
  logger: Logger,
): void {
  queueService.registerWorker("settlement-calculation", async (job: Job) => {
    const { tenantId, merchantAccountId, periodStart, periodEnd, currency, payoutMethod } = job.data as {
      tenantId: string;
      merchantAccountId: string;
      periodStart: string;
      periodEnd: string;
      currency?: string;
      payoutMethod?: "bank_transfer" | "wallet";
    };

    logger.info("settlement_worker_processing", { jobId: job.id, tenantId, merchantAccountId });

    await job.updateProgress(10);

    const settlementService = paymentService.getSettlementService(tenantId);
    const result = await settlementService.calculateSettlement(
      merchantAccountId,
      new Date(periodStart),
      new Date(periodEnd),
      currency,
      payoutMethod,
    );

    await job.updateProgress(100);

    if (!result.ok) {
      throw new Error(`Settlement calculation failed: ${result.error.message}`);
    }

    return { settlementId: result.value.id, netAmount: result.value.netAmount };
  });
}

import type { Job } from "bullmq";
import type { QueueService } from "../queue-service.js";
import type { PaymentService } from "../../api/payment-service.js";
import type { Logger } from "../../core/logger.js";

export function registerDisputeWorker(
  queueService: QueueService,
  paymentService: PaymentService,
  logger: Logger,
): void {
  queueService.registerWorker("dispute-resolution", async (job: Job) => {
    const { action, tenantId, disputeId } = job.data as {
      action: string;
      tenantId: string;
      disputeId: string;
    };

    const disputeService = paymentService.getDisputeService(tenantId);

    if (action === "progress-lifecycle") {
      logger.info("dispute_worker_progressing", { jobId: job.id, tenantId, disputeId });

      const disputeResult = await disputeService.getDispute(disputeId);
      if (!disputeResult.ok) {
        throw new Error(`Dispute not found: ${disputeResult.error.message}`);
      }

      const dispute = disputeResult.value;

      // Simulate lifecycle progression for sandbox disputes
      if (dispute.status === "needs_response") {
        const evidenceDue = new Date(dispute.evidenceDueBy);
        if (evidenceDue < new Date()) {
          const result = await disputeService.resolveDispute(disputeId, "lost");
          if (!result.ok) throw new Error(result.error.message);
          return { disputeId, newStatus: "lost", reason: "evidence_deadline_passed" };
        }
      }

      if (dispute.status === "under_review") {
        // Simulate: 60% chance of winning
        const outcome = Math.random() < 0.6 ? "won" : "lost";
        const result = await disputeService.resolveDispute(disputeId, outcome);
        if (!result.ok) throw new Error(result.error.message);
        return { disputeId, newStatus: outcome };
      }

      return { disputeId, status: dispute.status, action: "no_change" };
    }

    throw new Error(`Unknown dispute worker action: ${action}`);
  });
}

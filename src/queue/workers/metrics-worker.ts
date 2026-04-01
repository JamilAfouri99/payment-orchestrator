import type { Job } from "bullmq";
import type { QueueService } from "../queue-service.js";
import type { PaymentService } from "../../api/payment-service.js";
import type { Logger } from "../../core/logger.js";
import { buildTimeWindow } from "../../analytics/analytics-service.js";

export function registerMetricsWorker(
  queueService: QueueService,
  paymentService: PaymentService,
  logger: Logger,
): void {
  queueService.registerWorker("metrics-computation", async (job: Job) => {
    const { tenantId, windowName } = job.data as {
      tenantId: string;
      windowName?: "1h" | "24h" | "7d" | "30d" | "90d";
    };

    const window = buildTimeWindow(windowName ?? "1h");

    logger.info("metrics_worker_computing", {
      jobId: job.id,
      tenantId,
      window: window.name,
      from: window.start.toISOString(),
      to: window.end.toISOString(),
    });

    await job.updateProgress(10);

    const analyticsService = paymentService.getAnalyticsService(tenantId);
    const result = await analyticsService.computeMetrics(window);

    await job.updateProgress(100);

    if (!result.ok) {
      throw new Error(`Metrics computation failed: ${result.error.message}`);
    }

    return { metricsComputed: result.value.length, window: window.name };
  });
}

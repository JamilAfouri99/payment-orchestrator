import type { Job } from "bullmq";
import type { QueueService } from "../queue-service.js";
import type { PaymentService } from "../../api/payment-service.js";
import type { Logger } from "../../core/logger.js";

export function registerReportWorker(
  queueService: QueueService,
  paymentService: PaymentService,
  logger: Logger,
): void {
  queueService.registerWorker("report-generation", async (job: Job) => {
    const { tenantId, reportType, params } = job.data as {
      tenantId: string;
      reportType: string;
      params: Record<string, unknown>;
    };

    logger.info("report_worker_processing", { jobId: job.id, tenantId, reportType });

    await job.updateProgress(10);

    const reportService = paymentService.getReportService(tenantId);

    if (reportType === "settlement-csv") {
      const settlementId = params["settlementId"] as string;
      const settlementService = paymentService.getSettlementService(tenantId);
      const result = await settlementService.exportCsv(settlementId);
      await job.updateProgress(100);
      if (!result.ok) throw new Error(`Report generation failed: ${result.error.message}`);
      return { reportType, content: result.value };
    }

    const dateRange = {
      start: params["from"] ? new Date(params["from"] as string) : new Date(Date.now() - 30 * 86_400_000),
      end: params["to"] ? new Date(params["to"] as string) : new Date(),
    };

    let result;
    switch (reportType) {
      case "transactions":
        result = await reportService.generateTransactionReport({
          dateRange,
        });
        break;
      case "settlements":
        result = await reportService.generateSettlementReport(dateRange);
        break;
      case "disputes":
        result = await reportService.generateDisputeReport(dateRange);
        break;
      case "revenue":
        result = await reportService.generateRevenueReport(dateRange);
        break;
      default:
        throw new Error(`Unknown report type: ${reportType}`);
    }

    await job.updateProgress(100);

    if (!result.ok) {
      throw new Error(`Report generation failed: ${result.error.message}`);
    }

    return { reportType, reportId: result.value.id };
  });
}

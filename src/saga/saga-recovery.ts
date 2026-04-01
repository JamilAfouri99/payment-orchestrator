import type { PrismaClient } from "@prisma/client";
import type { Logger } from "../core/logger.js";

export interface RecoveryResult {
  found: number;
  compensated: number;
  failed: number;
  details: Array<{ sagaId: string; aggregateId: string; outcome: string }>;
}

/**
 * Scans for sagas left in 'running' or 'compensating' state (from crashes)
 * and marks them for recovery. In a production system this would resume
 * or compensate; here we mark them as failed with a recovery note.
 * @param prisma - PrismaClient instance
 * @param logger - Structured logger
 * @param tenantId - Optional tenant scope; omit to recover all tenants (startup recovery)
 * @returns Recovery results
 */
export async function recoverIncompleteSagas(
  prisma: PrismaClient,
  logger: Logger,
  tenantId?: string,
): Promise<RecoveryResult> {
  const incomplete = await prisma.sagaExecution.findMany({
    where: {
      ...(tenantId !== undefined ? { tenantId } : {}),
      status: { in: ["running", "compensating"] },
    },
  });

  if (incomplete.length === 0) {
    logger.info("saga_recovery", { message: "No incomplete sagas found" });
    return { found: 0, compensated: 0, failed: 0, details: [] };
  }

  logger.warn("saga_recovery", {
    message: `Found ${incomplete.length} incomplete saga(s)`,
    sagaIds: incomplete.map((s) => s.id),
  });

  const details: RecoveryResult["details"] = [];
  let compensated = 0;
  let failed = 0;

  for (const saga of incomplete) {
    try {
      await prisma.sagaExecution.update({
        where: { id: saga.id },
        data: {
          status: "failed",
          error: `Recovered on startup: was in '${saga.status}' state at step ${saga.currentStep}`,
        },
      });

      compensated++;
      details.push({
        sagaId: saga.id,
        aggregateId: saga.aggregateId,
        outcome: "marked_failed",
      });

      logger.info("saga_recovery", {
        sagaId: saga.id,
        aggregateId: saga.aggregateId,
        previousStatus: saga.status,
        outcome: "marked_failed",
      });
    } catch (error) {
      failed++;
      details.push({
        sagaId: saga.id,
        aggregateId: saga.aggregateId,
        outcome: "recovery_error",
      });

      logger.error("saga_recovery", {
        sagaId: saga.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { found: incomplete.length, compensated, failed, details };
}

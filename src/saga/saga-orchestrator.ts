import { PrismaClient } from "@prisma/client";
import { type Result, ok, err } from "../core/result.js";

export class SagaError extends Error {
  constructor(
    message: string,
    public readonly code: "STEP_FAILED" | "COMPENSATION_FAILED" | "PERSISTENCE_FAILED",
    public readonly stepIndex?: number,
  ) {
    super(message);
    this.name = "SagaError";
  }
}

export interface SagaStep<TContext> {
  name: string;
  execute(context: TContext): Promise<Result<TContext, Error>>;
  compensate(context: TContext): Promise<Result<TContext, Error>>;
}

export type SagaStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "compensating"
  | "compensated";

export interface SagaResult<TContext> {
  sagaId: string;
  status: SagaStatus;
  context: TContext;
  completedSteps: string[];
  error?: string;
}

export interface SagaOrchestrator<TContext> {
  /**
   * Executes the saga from start to finish, persisting state at each step.
   * On failure, compensates all completed steps in reverse order.
   * @param aggregateId - The aggregate this saga operates on
   * @param initialContext - Starting context data
   * @returns Final saga result with status and context
   */
  execute(aggregateId: string, initialContext: TContext): Promise<Result<SagaResult<TContext>, SagaError>>;
}

/**
 * Creates a saga orchestrator that persists state to PostgreSQL.
 * @param prisma - PrismaClient instance
 * @param sagaType - Identifier for this saga type (e.g., "payment")
 * @param steps - Ordered list of saga steps
 * @param tenantId - Tenant scope for all operations
 * @returns SagaOrchestrator instance
 */
export function createSagaOrchestrator<TContext>(
  prisma: PrismaClient,
  sagaType: string,
  steps: SagaStep<TContext>[],
  tenantId: string,
): SagaOrchestrator<TContext> {
  return {
    async execute(aggregateId, initialContext) {
      const saga = await createSagaRecord(prisma, sagaType, aggregateId, tenantId);
      if (!saga.ok) return saga;

      const sagaId = saga.value;
      let context = initialContext;
      const completedSteps: string[] = [];

      await updateSagaStatus(prisma, sagaId, "running", context, completedSteps);

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;

        await updateSagaStep(prisma, sagaId, i, context, completedSteps);

        const result = await step.execute(context);

        if (!result.ok) {
          const errorMsg = result.error.message;
          await updateSagaStatus(prisma, sagaId, "compensating", context, completedSteps, errorMsg);

          const compensationResult = await compensateSteps(
            prisma,
            sagaId,
            steps,
            completedSteps,
            context,
          );

          if (!compensationResult.ok) {
            return err(
              new SagaError(
                `Compensation failed after step "${step.name}" failed: ${compensationResult.error.message}`,
                "COMPENSATION_FAILED",
                i,
              ),
            );
          }

          context = compensationResult.value;
          await updateSagaStatus(prisma, sagaId, "compensated", context, completedSteps, errorMsg);

          return ok({
            sagaId,
            status: "compensated" as SagaStatus,
            context,
            completedSteps,
            error: errorMsg,
          });
        }

        context = result.value;
        completedSteps.push(step.name);
      }

      await updateSagaStatus(prisma, sagaId, "completed", context, completedSteps);

      return ok({
        sagaId,
        status: "completed" as SagaStatus,
        context,
        completedSteps,
      });
    },
  };
}

async function createSagaRecord(
  prisma: PrismaClient,
  sagaType: string,
  aggregateId: string,
  tenantId: string,
): Promise<Result<string, SagaError>> {
  try {
    const record = await prisma.sagaExecution.create({
      data: { tenantId, sagaType, aggregateId },
    });
    return ok(record.id);
  } catch (error) {
    return err(
      new SagaError(
        `Failed to create saga record: ${error instanceof Error ? error.message : String(error)}`,
        "PERSISTENCE_FAILED",
      ),
    );
  }
}

async function updateSagaStatus<TContext>(
  prisma: PrismaClient,
  sagaId: string,
  status: SagaStatus,
  context: TContext,
  completedSteps: string[],
  error?: string,
): Promise<void> {
  await prisma.sagaExecution.update({
    where: { id: sagaId },
    data: {
      status,
      context: JSON.parse(JSON.stringify(context)),
      completedSteps: JSON.parse(JSON.stringify(completedSteps)),
      error: error ?? null,
    },
  });
}

async function updateSagaStep<TContext>(
  prisma: PrismaClient,
  sagaId: string,
  stepIndex: number,
  context: TContext,
  completedSteps: string[],
): Promise<void> {
  await prisma.sagaExecution.update({
    where: { id: sagaId },
    data: {
      currentStep: stepIndex,
      context: JSON.parse(JSON.stringify(context)),
      completedSteps: JSON.parse(JSON.stringify(completedSteps)),
    },
  });
}

async function compensateSteps<TContext>(
  prisma: PrismaClient,
  sagaId: string,
  steps: SagaStep<TContext>[],
  completedSteps: string[],
  context: TContext,
): Promise<Result<TContext, SagaError>> {
  let currentContext = context;

  for (let i = completedSteps.length - 1; i >= 0; i--) {
    const stepName = completedSteps[i]!;
    const step = steps.find((s) => s.name === stepName);

    if (!step) continue;

    const result = await step.compensate(currentContext);

    if (!result.ok) {
      await updateSagaStatus(prisma, sagaId, "failed", currentContext, completedSteps, result.error.message);
      return err(
        new SagaError(
          `Compensation of step "${stepName}" failed: ${result.error.message}`,
          "COMPENSATION_FAILED",
        ),
      );
    }

    currentContext = result.value;
  }

  return ok(currentContext);
}

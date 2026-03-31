import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSagaOrchestrator, type SagaStep } from "./saga-orchestrator.js";
import { ok, err } from "../core/result.js";

interface TestContext {
  value: number;
  log: string[];
}

function createMockPrisma() {
  const records: Record<string, unknown> = {};
  return {
    sagaExecution: {
      create: vi.fn().mockImplementation(async ({ data }: { data: { sagaType: string; aggregateId: string } }) => {
        const id = `saga_${Date.now()}`;
        records[id] = { id, ...data };
        return { id, ...data };
      }),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as import("@prisma/client").PrismaClient;
}

function createStep(
  name: string,
  shouldFail: boolean = false,
  compensateFail: boolean = false,
): SagaStep<TestContext> {
  return {
    name,
    async execute(ctx) {
      if (shouldFail) {
        return err(new Error(`${name} failed`));
      }
      return ok({ ...ctx, value: ctx.value + 1, log: [...ctx.log, `${name}:execute`] });
    },
    async compensate(ctx) {
      if (compensateFail) {
        return err(new Error(`${name} compensate failed`));
      }
      return ok({ ...ctx, log: [...ctx.log, `${name}:compensate`] });
    },
  };
}

describe("SagaOrchestrator", () => {
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  it("completes all steps in the happy path", async () => {
    const steps = [createStep("step1"), createStep("step2"), createStep("step3")];
    const orchestrator = createSagaOrchestrator(prisma, "test", steps);

    const result = await orchestrator.execute("agg-1", { value: 0, log: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("completed");
    expect(result.value.context.value).toBe(3);
    expect(result.value.completedSteps).toEqual(["step1", "step2", "step3"]);
    expect(result.value.context.log).toEqual([
      "step1:execute",
      "step2:execute",
      "step3:execute",
    ]);
  });

  it("compensates previous steps on failure", async () => {
    const steps = [
      createStep("step1"),
      createStep("step2"),
      createStep("step3", true), // fails
    ];
    const orchestrator = createSagaOrchestrator(prisma, "test", steps);

    const result = await orchestrator.execute("agg-2", { value: 0, log: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("compensated");
    expect(result.value.error).toBe("step3 failed");
    // Compensation runs in reverse order
    expect(result.value.context.log).toEqual([
      "step1:execute",
      "step2:execute",
      "step2:compensate",
      "step1:compensate",
    ]);
  });

  it("reports compensation failure", async () => {
    const steps = [
      createStep("step1"),
      createStep("step2", false, true), // compensate will fail
      createStep("step3", true), // execute fails, triggering compensation
    ];
    const orchestrator = createSagaOrchestrator(prisma, "test", steps);

    const result = await orchestrator.execute("agg-3", { value: 0, log: [] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("COMPENSATION_FAILED");
  });

  it("handles single-step saga", async () => {
    const steps = [createStep("only")];
    const orchestrator = createSagaOrchestrator(prisma, "test", steps);

    const result = await orchestrator.execute("agg-4", { value: 0, log: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("completed");
    expect(result.value.context.value).toBe(1);
  });

  it("returns the same response for idempotent replay with same aggregate", async () => {
    const steps = [createStep("step1")];
    const orchestrator = createSagaOrchestrator(prisma, "test", steps);

    const result1 = await orchestrator.execute("agg-5", { value: 0, log: [] });
    const result2 = await orchestrator.execute("agg-5", { value: 0, log: [] });

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (!result1.ok || !result2.ok) return;
    expect(result1.value.status).toBe(result2.value.status);
  });

  it("persists saga state to database", async () => {
    const steps = [createStep("step1")];
    const orchestrator = createSagaOrchestrator(prisma, "test", steps);

    await orchestrator.execute("agg-6", { value: 0, log: [] });

    expect(prisma.sagaExecution.create).toHaveBeenCalledOnce();
    expect(prisma.sagaExecution.update).toHaveBeenCalled();
  });

  it("compensates first step failure with no steps to compensate", async () => {
    const steps = [createStep("step1", true)];
    const orchestrator = createSagaOrchestrator(prisma, "test", steps);

    const result = await orchestrator.execute("agg-7", { value: 0, log: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("compensated");
    expect(result.value.completedSteps).toEqual([]);
  });
});

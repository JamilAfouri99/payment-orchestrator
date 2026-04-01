import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import type { EventStore } from "../events/event-store.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ExperimentStatus = "draft" | "running" | "paused" | "completed";

export interface ExperimentVariant {
  name: string;
  providerId: string;
  weight: number;
}

export interface Experiment {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  status: ExperimentStatus;
  controlProviderId: string;
  controlWeight: number;
  variants: ExperimentVariant[];
  trafficAllocation: number;
  targetMetrics: string[];
  minimumSampleSize: number;
  confidenceLevel: number;
  winnerVariant: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface CreateExperimentInput {
  name: string;
  description?: string | undefined;
  controlProviderId: string;
  controlWeight?: number | undefined;
  variants: ExperimentVariant[];
  trafficAllocation?: number | undefined;
  targetMetrics?: string[] | undefined;
  minimumSampleSize?: number | undefined;
  confidenceLevel?: number | undefined;
}

export interface VariantAssignment {
  experimentId: string;
  variantName: string;
  providerId: string;
}

export interface VariantResult {
  name: string;
  providerId: string;
  sampleSize: number;
  authorizationRate: number;
  avgLatencyMs: number;
  costPerTransaction: number;
}

export interface ExperimentResults {
  experimentId: string;
  totalSamples: number;
  variants: VariantResult[];
  isSignificant: boolean;
  chiSquared: number;
  requiredSamples: number;
  winner: string | null;
}

// ── Error ────────────────────────────────────────────────────────────────────

export class ExperimentError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_STATUS"
      | "VALIDATION"
      | "EXPERIMENT_FAILURE",
  ) {
    super(message);
    this.name = "ExperimentError";
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["running"],
  running: ["paused", "completed"],
  paused: ["running", "completed"],
  completed: [],
};

// Chi-squared critical values for 1 degree of freedom
const CHI_SQUARED_CRITICAL: Record<number, number> = {
  90: 2.706,
  95: 3.841,
  99: 6.635,
};

// ── Service Interface ────────────────────────────────────────────────────────

export interface ExperimentService {
  createExperiment(input: CreateExperimentInput): Promise<Result<Experiment, ExperimentError>>;
  startExperiment(id: string): Promise<Result<Experiment, ExperimentError>>;
  pauseExperiment(id: string): Promise<Result<Experiment, ExperimentError>>;
  completeExperiment(id: string): Promise<Result<Experiment, ExperimentError>>;
  getExperiment(id: string): Promise<Result<Experiment, ExperimentError>>;
  listExperiments(): Promise<Result<Experiment[], ExperimentError>>;
  assignVariant(experimentId: string, paymentId: string): Result<VariantAssignment, ExperimentError>;
  getResults(experimentId: string): Promise<Result<ExperimentResults, ExperimentError>>;
  declareWinner(experimentId: string, variantName: string): Promise<Result<Experiment, ExperimentError>>;
  getActiveExperiment(): Promise<Result<Experiment | null, ExperimentError>>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toExperiment(record: {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  status: string;
  controlProviderId: string;
  controlWeight: number;
  variants: unknown;
  trafficAllocation: number;
  targetMetrics: unknown;
  minimumSampleSize: number;
  confidenceLevel: number;
  winnerVariant: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
}): Experiment {
  return {
    id: record.id,
    tenantId: record.tenantId,
    name: record.name,
    description: record.description,
    status: record.status as ExperimentStatus,
    controlProviderId: record.controlProviderId,
    controlWeight: record.controlWeight,
    variants: record.variants as ExperimentVariant[],
    trafficAllocation: record.trafficAllocation,
    targetMetrics: record.targetMetrics as string[],
    minimumSampleSize: record.minimumSampleSize,
    confidenceLevel: record.confidenceLevel,
    winnerVariant: record.winnerVariant,
    startedAt: record.startedAt?.toISOString() ?? null,
    endedAt: record.endedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

/** Deterministic variant assignment based on paymentId hash */
function hashToWeight(paymentId: string): number {
  let hash = 0;
  for (let i = 0; i < paymentId.length; i++) {
    const char = paymentId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) % 100;
}

/** Chi-squared test for 2x2 contingency table */
export function chiSquaredTest(
  controlSuccesses: number,
  controlTotal: number,
  variantSuccesses: number,
  variantTotal: number,
): number {
  const total = controlTotal + variantTotal;
  if (total === 0) return 0;

  const totalSuccesses = controlSuccesses + variantSuccesses;
  const totalFailures = total - totalSuccesses;

  // Expected values
  const expectedControlSuccess = (controlTotal * totalSuccesses) / total;
  const expectedControlFailure = (controlTotal * totalFailures) / total;
  const expectedVariantSuccess = (variantTotal * totalSuccesses) / total;
  const expectedVariantFailure = (variantTotal * totalFailures) / total;

  // Avoid division by zero
  if (expectedControlSuccess === 0 || expectedControlFailure === 0 ||
      expectedVariantSuccess === 0 || expectedVariantFailure === 0) {
    return 0;
  }

  const controlSuccessChi = Math.pow(controlSuccesses - expectedControlSuccess, 2) / expectedControlSuccess;
  const controlFailureChi = Math.pow((controlTotal - controlSuccesses) - expectedControlFailure, 2) / expectedControlFailure;
  const variantSuccessChi = Math.pow(variantSuccesses - expectedVariantSuccess, 2) / expectedVariantSuccess;
  const variantFailureChi = Math.pow((variantTotal - variantSuccesses) - expectedVariantFailure, 2) / expectedVariantFailure;

  return Math.round((controlSuccessChi + controlFailureChi + variantSuccessChi + variantFailureChi) * 10000) / 10000;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createExperimentService(
  prisma: PrismaClient,
  tenantId: string,
  _eventStore: EventStore,
): ExperimentService {

  // Cache the active experiment to avoid repeated DB lookups on every payment
  let cachedActiveExperiment: Experiment | null | undefined;

  return {
    async createExperiment(input) {
      if (!input.name) {
        return err(new ExperimentError("Experiment name is required", "VALIDATION"));
      }
      if (!input.controlProviderId) {
        return err(new ExperimentError("Control provider ID is required", "VALIDATION"));
      }
      if (!input.variants || input.variants.length === 0) {
        return err(new ExperimentError("At least one variant is required", "VALIDATION"));
      }

      const controlWeight = input.controlWeight ?? 50;
      const totalWeight = controlWeight + input.variants.reduce((sum, v) => sum + v.weight, 0);
      if (totalWeight !== 100) {
        return err(new ExperimentError(
          `Total weights must equal 100, got ${totalWeight}`,
          "VALIDATION",
        ));
      }

      try {
        const record = await prisma.routingExperiment.create({
          data: {
            id: uuid(),
            tenantId,
            name: input.name,
            description: input.description ?? "",
            status: "draft",
            controlProviderId: input.controlProviderId,
            controlWeight,
            variants: input.variants as unknown as import("@prisma/client").Prisma.InputJsonValue,
            trafficAllocation: input.trafficAllocation ?? 100,
            targetMetrics: (input.targetMetrics ?? ["authorization_rate"]) as unknown as import("@prisma/client").Prisma.InputJsonValue,
            minimumSampleSize: input.minimumSampleSize ?? 1000,
            confidenceLevel: input.confidenceLevel ?? 95,
          },
        });
        return ok(toExperiment(record));
      } catch (error) {
        return err(new ExperimentError(
          `Failed to create experiment: ${error instanceof Error ? error.message : String(error)}`,
          "EXPERIMENT_FAILURE",
        ));
      }
    },

    async startExperiment(id) {
      try {
        const record = await prisma.routingExperiment.findFirst({
          where: { id, tenantId },
        });
        if (!record) return err(new ExperimentError(`Experiment ${id} not found`, "NOT_FOUND"));

        const allowed = VALID_TRANSITIONS[record.status];
        if (!allowed || !allowed.includes("running")) {
          return err(new ExperimentError(
            `Cannot start experiment in ${record.status} status`,
            "INVALID_STATUS",
          ));
        }

        // Only one experiment can be running at a time per tenant
        const running = await prisma.routingExperiment.findFirst({
          where: { tenantId, status: "running", id: { not: id } },
        });
        if (running) {
          return err(new ExperimentError(
            `Another experiment "${running.name}" is already running`,
            "INVALID_STATUS",
          ));
        }

        const updated = await prisma.routingExperiment.update({
          where: { id },
          data: { status: "running", startedAt: new Date() },
        });

        cachedActiveExperiment = toExperiment(updated);
        return ok(cachedActiveExperiment);
      } catch (error) {
        return err(new ExperimentError(
          `Failed to start experiment: ${error instanceof Error ? error.message : String(error)}`,
          "EXPERIMENT_FAILURE",
        ));
      }
    },

    async pauseExperiment(id) {
      try {
        const record = await prisma.routingExperiment.findFirst({
          where: { id, tenantId },
        });
        if (!record) return err(new ExperimentError(`Experiment ${id} not found`, "NOT_FOUND"));

        const allowed = VALID_TRANSITIONS[record.status];
        if (!allowed || !allowed.includes("paused")) {
          return err(new ExperimentError(
            `Cannot pause experiment in ${record.status} status`,
            "INVALID_STATUS",
          ));
        }

        const updated = await prisma.routingExperiment.update({
          where: { id },
          data: { status: "paused" },
        });

        cachedActiveExperiment = undefined;
        return ok(toExperiment(updated));
      } catch (error) {
        return err(new ExperimentError(
          `Failed to pause experiment: ${error instanceof Error ? error.message : String(error)}`,
          "EXPERIMENT_FAILURE",
        ));
      }
    },

    async completeExperiment(id) {
      try {
        const record = await prisma.routingExperiment.findFirst({
          where: { id, tenantId },
        });
        if (!record) return err(new ExperimentError(`Experiment ${id} not found`, "NOT_FOUND"));

        const allowed = VALID_TRANSITIONS[record.status];
        if (!allowed || !allowed.includes("completed")) {
          return err(new ExperimentError(
            `Cannot complete experiment in ${record.status} status`,
            "INVALID_STATUS",
          ));
        }

        const updated = await prisma.routingExperiment.update({
          where: { id },
          data: { status: "completed", endedAt: new Date() },
        });

        cachedActiveExperiment = undefined;
        return ok(toExperiment(updated));
      } catch (error) {
        return err(new ExperimentError(
          `Failed to complete experiment: ${error instanceof Error ? error.message : String(error)}`,
          "EXPERIMENT_FAILURE",
        ));
      }
    },

    async getExperiment(id) {
      try {
        const record = await prisma.routingExperiment.findFirst({
          where: { id, tenantId },
        });
        if (!record) return err(new ExperimentError(`Experiment ${id} not found`, "NOT_FOUND"));
        return ok(toExperiment(record));
      } catch (error) {
        return err(new ExperimentError(
          `Failed to get experiment: ${error instanceof Error ? error.message : String(error)}`,
          "EXPERIMENT_FAILURE",
        ));
      }
    },

    async listExperiments() {
      try {
        const records = await prisma.routingExperiment.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
        });
        return ok(records.map(toExperiment));
      } catch (error) {
        return err(new ExperimentError(
          `Failed to list experiments: ${error instanceof Error ? error.message : String(error)}`,
          "EXPERIMENT_FAILURE",
        ));
      }
    },

    assignVariant(experimentId, paymentId) {
      if (!cachedActiveExperiment || cachedActiveExperiment.id !== experimentId) {
        return err(new ExperimentError(`Experiment ${experimentId} is not active`, "INVALID_STATUS"));
      }

      const experiment = cachedActiveExperiment;

      // Check traffic allocation
      const trafficDice = hashToWeight(paymentId + ":traffic");
      if (trafficDice >= experiment.trafficAllocation) {
        return err(new ExperimentError("Payment not enrolled in experiment", "VALIDATION"));
      }

      // Assign to control or variant based on weight
      const weightDice = hashToWeight(paymentId + ":variant");
      let cumulative = 0;

      // Control
      cumulative += experiment.controlWeight;
      if (weightDice < cumulative) {
        return ok({
          experimentId,
          variantName: "control",
          providerId: experiment.controlProviderId,
        });
      }

      // Variants
      for (const variant of experiment.variants) {
        cumulative += variant.weight;
        if (weightDice < cumulative) {
          return ok({
            experimentId,
            variantName: variant.name,
            providerId: variant.providerId,
          });
        }
      }

      // Fallback to last variant (rounding edge case)
      const lastVariant = experiment.variants[experiment.variants.length - 1]!;
      return ok({
        experimentId,
        variantName: lastVariant.name,
        providerId: lastVariant.providerId,
      });
    },

    async getResults(experimentId) {
      try {
        const record = await prisma.routingExperiment.findFirst({
          where: { id: experimentId, tenantId },
        });
        if (!record) return err(new ExperimentError(`Experiment ${experimentId} not found`, "NOT_FOUND"));

        const experiment = toExperiment(record);

        // Query all ExperimentAssigned events for this experiment
        const assignmentEvents = await prisma.eventStore.findMany({
          where: {
            tenantId,
            eventType: "ExperimentAssigned",
          },
          select: { aggregateId: true, payload: true, metadata: true },
        });

        // Filter to this experiment's assignments
        const experimentAssignments = assignmentEvents.filter((e) => {
          const payload = e.payload as Record<string, unknown>;
          return payload["experimentId"] === experimentId;
        });

        // Build variant tracking maps
        const variantData = new Map<string, {
          providerId: string;
          total: number;
          successes: number;
          totalLatency: number;
          totalCost: number;
        }>();

        // Initialize control
        variantData.set("control", {
          providerId: experiment.controlProviderId,
          total: 0,
          successes: 0,
          totalLatency: 0,
          totalCost: 0,
        });

        // Initialize variants
        for (const v of experiment.variants) {
          variantData.set(v.name, {
            providerId: v.providerId,
            total: 0,
            successes: 0,
            totalLatency: 0,
            totalCost: 0,
          });
        }

        // Aggregate results from provider metrics
        for (const assignment of experimentAssignments) {
          const payload = assignment.payload as Record<string, unknown>;
          const variantName = typeof payload["variantName"] === "string" ? payload["variantName"] : "control";
          const providerId = typeof payload["providerId"] === "string" ? payload["providerId"] : "";

          const data = variantData.get(variantName);
          if (!data) continue;
          data.total++;

          // Check if this payment succeeded by looking for completion events
          const completionEvent = await prisma.eventStore.findFirst({
            where: {
              tenantId,
              aggregateId: assignment.aggregateId,
              eventType: { in: ["PaymentCompleted", "PaymentFailed"] },
            },
          });

          if (completionEvent?.eventType === "PaymentCompleted") {
            data.successes++;
          }

          // Get latency from provider metrics for this payment's provider
          const metrics = await prisma.providerMetric.findMany({
            where: {
              tenantId,
              provider: providerId,
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          });
          if (metrics[0]) {
            data.totalLatency += metrics[0].latencyMs;
          }
        }

        // Compute variant results
        const variantResults: VariantResult[] = [];
        for (const [name, data] of variantData) {
          variantResults.push({
            name,
            providerId: data.providerId,
            sampleSize: data.total,
            authorizationRate: data.total > 0
              ? Math.round((data.successes / data.total) * 10000) / 10000
              : 0,
            avgLatencyMs: data.total > 0
              ? Math.round(data.totalLatency / data.total)
              : 0,
            costPerTransaction: 0, // Would need provider config to compute
          });
        }

        const totalSamples = variantResults.reduce((sum, v) => sum + v.sampleSize, 0);

        // Chi-squared test: compare control vs all variants combined
        const controlData = variantData.get("control")!;
        let variantTotalSuccesses = 0;
        let variantTotalCount = 0;
        for (const [name, data] of variantData) {
          if (name !== "control") {
            variantTotalSuccesses += data.successes;
            variantTotalCount += data.total;
          }
        }

        const chiSquared = chiSquaredTest(
          controlData.successes,
          controlData.total,
          variantTotalSuccesses,
          variantTotalCount,
        );

        const criticalValue = CHI_SQUARED_CRITICAL[experiment.confidenceLevel] ?? 3.841;
        const isSignificant = chiSquared >= criticalValue && totalSamples >= experiment.minimumSampleSize;

        // Determine winner if significant
        let winner: string | null = null;
        if (isSignificant) {
          let bestRate = 0;
          for (const result of variantResults) {
            if (result.authorizationRate > bestRate) {
              bestRate = result.authorizationRate;
              winner = result.name;
            }
          }
        }

        return ok({
          experimentId,
          totalSamples,
          variants: variantResults,
          isSignificant,
          chiSquared,
          requiredSamples: experiment.minimumSampleSize,
          winner,
        });
      } catch (error) {
        return err(new ExperimentError(
          `Failed to get results: ${error instanceof Error ? error.message : String(error)}`,
          "EXPERIMENT_FAILURE",
        ));
      }
    },

    async declareWinner(experimentId, variantName) {
      try {
        const record = await prisma.routingExperiment.findFirst({
          where: { id: experimentId, tenantId },
        });
        if (!record) return err(new ExperimentError(`Experiment ${experimentId} not found`, "NOT_FOUND"));

        const experiment = toExperiment(record);
        const validNames = ["control", ...experiment.variants.map((v) => v.name)];
        if (!validNames.includes(variantName)) {
          return err(new ExperimentError(
            `Invalid variant name: ${variantName}. Must be one of: ${validNames.join(", ")}`,
            "VALIDATION",
          ));
        }

        const updated = await prisma.routingExperiment.update({
          where: { id: experimentId },
          data: {
            status: "completed",
            endedAt: new Date(),
            winnerVariant: variantName,
          },
        });

        cachedActiveExperiment = undefined;
        return ok(toExperiment(updated));
      } catch (error) {
        return err(new ExperimentError(
          `Failed to declare winner: ${error instanceof Error ? error.message : String(error)}`,
          "EXPERIMENT_FAILURE",
        ));
      }
    },

    async getActiveExperiment() {
      try {
        if (cachedActiveExperiment !== undefined) {
          return ok(cachedActiveExperiment);
        }

        const record = await prisma.routingExperiment.findFirst({
          where: { tenantId, status: "running" },
        });

        cachedActiveExperiment = record ? toExperiment(record) : null;
        return ok(cachedActiveExperiment);
      } catch (error) {
        return err(new ExperimentError(
          `Failed to get active experiment: ${error instanceof Error ? error.message : String(error)}`,
          "EXPERIMENT_FAILURE",
        ));
      }
    },
  };
}

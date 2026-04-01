import { type Result, ok, err } from "../core/result.js";
import type { Cents } from "../core/types.js";
import type { CircuitBreakerRegistry } from "../circuit-breaker/circuit-breaker-registry.js";
import type { ProviderRegistry, ChargeAdapterResult, ProviderError } from "./provider-registry.js";
import type { ProviderMetrics } from "./provider-metrics.js";
import type { Logger } from "../core/logger.js";

export interface RoutingParams {
  amount: Cents;
  currency: string;
  region: string;
  customerId: string;
}

export interface RoutingDecision {
  providerId: string;
  score: number;
  reasons: string[];
  fallbackOrder: string[];
}

export class RoutingError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_ELIGIBLE_PROVIDER" | "ALL_PROVIDERS_FAILED" | "ROUTING_FAILURE",
    public readonly lastDeclineCode?: string | undefined,
  ) {
    super(message);
    this.name = "RoutingError";
  }
}

export interface RoutingEngine {
  selectProvider(params: RoutingParams): Promise<Result<RoutingDecision, RoutingError>>;
  executeWithFallback(params: RoutingParams): Promise<Result<ChargeAdapterResult, RoutingError>>;
  simulateRouting(params: RoutingParams): Promise<Result<RoutingDecision, RoutingError>>;
}

interface RoutingWeights {
  cbHealth: number;
  successRate: number;
  cost: number;
  regionMatch: number;
}

const DEFAULT_WEIGHTS: RoutingWeights = {
  cbHealth: 0.40,
  successRate: 0.30,
  cost: 0.20,
  regionMatch: 0.10,
};

const METRICS_WINDOW_MS = 3600_000; // 1 hour
const MAX_FALLBACK_ATTEMPTS = 3;

export function createRoutingEngine(deps: {
  registry: ProviderRegistry;
  cbRegistry: CircuitBreakerRegistry;
  metrics: ProviderMetrics;
  logger: Logger;
  weights?: RoutingWeights | undefined;
}): RoutingEngine {
  const { registry, cbRegistry, metrics, logger } = deps;
  const weights = deps.weights ?? DEFAULT_WEIGHTS;

  async function scoreProviders(params: RoutingParams): Promise<{ providerId: string; score: number; reasons: string[] }[]> {
    const eligible = registry.getEligible(params.currency, params.amount, params.region);
    if (eligible.length === 0) return [];

    const maxCost = Math.max(...eligible.map((c) => c.costBasisPoints));
    const scored: { providerId: string; score: number; reasons: string[] }[] = [];

    for (const config of eligible) {
      let score = 0;
      const reasons: string[] = [];

      // CB health score
      const cbInfo = cbRegistry.getAll().find((b) => b.name === config.name);
      const cbState = cbInfo?.state ?? "closed";
      const cbScore = cbState === "closed" ? 1.0 : cbState === "half-open" ? 0.3 : 0.0;
      score += cbScore * weights.cbHealth;
      if (cbScore === 1.0) reasons.push("healthy_cb");
      if (cbScore === 0.0) reasons.push("open_cb");

      // Historical success rate
      const rateResult = await metrics.getSuccessRate(config.name, METRICS_WINDOW_MS);
      const successRate = rateResult.ok ? rateResult.value : 1.0;
      score += successRate * weights.successRate;
      if (successRate >= 0.95) reasons.push("high_success_rate");

      // Cost (inverse, normalized)
      const costScore = maxCost > 0 ? 1 - (config.costBasisPoints / maxCost) : 1;
      score += costScore * weights.cost;
      if (config.costBasisPoints === Math.min(...eligible.map((c) => c.costBasisPoints))) {
        reasons.push("lowest_cost");
      }

      // Region match
      if (config.supportedRegions.includes(params.region)) {
        score += weights.regionMatch;
        reasons.push("region_match");
      }

      // Settlement currency match bonus (no FX needed)
      if (config.settlementCurrency === params.currency) {
        score += 0.05;
        reasons.push("no_fx_needed");
      }

      scored.push({ providerId: config.name, score: Math.round(score * 1000) / 1000, reasons });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  return {
    async selectProvider(params) {
      const scored = await scoreProviders(params);
      if (scored.length === 0) {
        return err(new RoutingError(
          `No eligible provider for ${params.currency} ${params.amount} in ${params.region}`,
          "NO_ELIGIBLE_PROVIDER",
        ));
      }

      const best = scored[0]!;
      return ok({
        providerId: best.providerId,
        score: best.score,
        reasons: best.reasons,
        fallbackOrder: scored.slice(1).map((s) => s.providerId),
      });
    },

    async executeWithFallback(params) {
      const scored = await scoreProviders(params);
      if (scored.length === 0) {
        return err(new RoutingError(
          `No eligible provider for ${params.currency} ${params.amount} in ${params.region}`,
          "NO_ELIGIBLE_PROVIDER",
        ));
      }

      const attempts = scored.slice(0, MAX_FALLBACK_ATTEMPTS);
      let lastDeclineCode: string | undefined;

      for (let i = 0; i < attempts.length; i++) {
        const candidate = attempts[i]!;
        const adapter = registry.getAdapter(candidate.providerId);
        if (!adapter) continue;

        const cb = cbRegistry.get(candidate.providerId);

        logger.info("routing_attempt", {
          provider: candidate.providerId,
          attempt: i + 1,
          score: candidate.score,
          reasons: candidate.reasons,
          currency: params.currency,
          amount: params.amount,
        });

        const start = Date.now();
        let result: Result<ChargeAdapterResult, ProviderError | Error>;

        if (cb) {
          result = await cb.execute(() => adapter.charge(params.amount, params.customerId));
        } else {
          result = await adapter.charge(params.amount, params.customerId);
        }

        const latencyMs = Date.now() - start;

        if (result.ok) {
          await metrics.record({
            provider: candidate.providerId,
            outcome: "success",
            latencyMs,
            amount: params.amount,
            currency: params.currency,
          });

          logger.info("routing_success", {
            provider: candidate.providerId,
            attempt: i + 1,
            latencyMs,
          });

          return ok(result.value);
        }

        const declineCode = "declineCode" in result.error
          ? (result.error as ProviderError).declineCode
          : "unknown";

        lastDeclineCode = declineCode;

        await metrics.record({
          provider: candidate.providerId,
          outcome: "failure",
          latencyMs,
          declineCode,
          amount: params.amount,
          currency: params.currency,
        });

        logger.warn("routing_fallback", {
          provider: candidate.providerId,
          attempt: i + 1,
          declineCode,
          error: result.error.message,
          nextProvider: attempts[i + 1]?.providerId ?? "none",
        });
      }

      return err(new RoutingError(
        `All ${attempts.length} providers failed for ${params.currency} ${params.amount}`,
        "ALL_PROVIDERS_FAILED",
        lastDeclineCode,
      ));
    },

    async simulateRouting(params) {
      return this.selectProvider(params);
    },
  };
}

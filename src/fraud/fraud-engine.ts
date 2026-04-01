import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { type Result, ok, err } from "../core/result.js";
import type { PaymentRequest, Cents } from "../core/types.js";

export interface FraudContext {
  customerPaymentCount: number;
  customerAvgAmount: Cents;
  customerRegion: string;
  ipAddress?: string | undefined;
}

export interface RuleResult {
  ruleId: string;
  ruleName: string;
  ruleType: string;
  triggered: boolean;
  score: number;
  detail: string;
}

export type FraudAction = "allow" | "review" | "block";

export interface FraudResult {
  score: number;
  action: FraudAction;
  ruleResults: RuleResult[];
  evaluatedAt: string;
}

export interface FraudRuleRecord {
  id: string;
  name: string;
  description: string;
  ruleType: string;
  config: Record<string, unknown>;
  weight: number;
  enabled: boolean;
}

export class FraudError extends Error {
  constructor(
    message: string,
    public readonly code: "EVALUATION_FAILED" | "RULE_NOT_FOUND" | "PERSISTENCE_FAILED",
  ) {
    super(message);
    this.name = "FraudError";
  }
}

export interface FraudEngine {
  evaluate(payment: PaymentRequest, context: FraudContext): Promise<Result<FraudResult, FraudError>>;
  getRules(): Promise<Result<FraudRuleRecord[], FraudError>>;
  upsertRule(rule: Omit<FraudRuleRecord, "id"> & { id?: string | undefined }): Promise<Result<FraudRuleRecord, FraudError>>;
  deleteRule(ruleId: string): Promise<Result<void, FraudError>>;
  getEvaluation(paymentId: string): Promise<Result<FraudResult | null, FraudError>>;
  saveEvaluation(paymentId: string, result: FraudResult): Promise<Result<void, FraudError>>;
}

const ALLOW_THRESHOLD = 30;
const REVIEW_THRESHOLD = 70;

export function createFraudEngine(prisma: PrismaClient): FraudEngine {
  function scoreToAction(score: number): FraudAction {
    if (score <= ALLOW_THRESHOLD) return "allow";
    if (score <= REVIEW_THRESHOLD) return "review";
    return "block";
  }

  return {
    async evaluate(payment, context) {
      try {
        const rules = await prisma.fraudRule.findMany({ where: { enabled: true } });
        const ruleResults: RuleResult[] = [];
        let totalScore = 0;

        for (const rule of rules) {
          const config = rule.config as Record<string, unknown>;
          const result = evaluateRule(rule.ruleType, config, payment, context, rule.weight);
          ruleResults.push({
            ruleId: rule.id,
            ruleName: rule.name,
            ruleType: rule.ruleType,
            triggered: result.triggered,
            score: result.score,
            detail: result.detail,
          });
          totalScore += result.score;
        }

        const score = Math.min(100, totalScore);
        const action = scoreToAction(score);

        return ok({
          score,
          action,
          ruleResults,
          evaluatedAt: new Date().toISOString(),
        });
      } catch (error) {
        return err(new FraudError(
          `Fraud evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
          "EVALUATION_FAILED",
        ));
      }
    },

    async getRules() {
      try {
        const rules = await prisma.fraudRule.findMany({ orderBy: { weight: "desc" } });
        return ok(rules.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          ruleType: r.ruleType,
          config: r.config as Record<string, unknown>,
          weight: r.weight,
          enabled: r.enabled,
        })));
      } catch (error) {
        return err(new FraudError(
          `Failed to fetch rules: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },

    async upsertRule(rule) {
      try {
        const id = rule.id ?? uuid();
        const record = await prisma.fraudRule.upsert({
          where: { id },
          create: {
            id,
            name: rule.name,
            description: rule.description,
            ruleType: rule.ruleType,
            config: rule.config as object,
            weight: rule.weight,
            enabled: rule.enabled,
          },
          update: {
            name: rule.name,
            description: rule.description,
            ruleType: rule.ruleType,
            config: rule.config as object,
            weight: rule.weight,
            enabled: rule.enabled,
          },
        });
        return ok({
          id: record.id,
          name: record.name,
          description: record.description,
          ruleType: record.ruleType,
          config: record.config as Record<string, unknown>,
          weight: record.weight,
          enabled: record.enabled,
        });
      } catch (error) {
        return err(new FraudError(
          `Failed to upsert rule: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },

    async deleteRule(ruleId) {
      try {
        await prisma.fraudRule.delete({ where: { id: ruleId } });
        return ok(undefined);
      } catch (error) {
        return err(new FraudError(
          `Failed to delete rule: ${error instanceof Error ? error.message : String(error)}`,
          "RULE_NOT_FOUND",
        ));
      }
    },

    async getEvaluation(paymentId) {
      try {
        const record = await prisma.fraudEvaluation.findFirst({
          where: { paymentId },
          orderBy: { createdAt: "desc" },
        });
        if (!record) return ok(null);
        return ok({
          score: record.score,
          action: record.action as FraudAction,
          ruleResults: record.ruleResults as unknown as RuleResult[],
          evaluatedAt: record.createdAt.toISOString(),
        });
      } catch (error) {
        return err(new FraudError(
          `Failed to get evaluation: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },

    async saveEvaluation(paymentId, result) {
      try {
        await prisma.fraudEvaluation.create({
          data: {
            id: uuid(),
            paymentId,
            score: result.score,
            action: result.action,
            ruleResults: result.ruleResults as unknown as object,
          },
        });
        return ok(undefined);
      } catch (error) {
        return err(new FraudError(
          `Failed to save evaluation: ${error instanceof Error ? error.message : String(error)}`,
          "PERSISTENCE_FAILED",
        ));
      }
    },
  };
}

function evaluateRule(
  ruleType: string,
  config: Record<string, unknown>,
  payment: PaymentRequest,
  context: FraudContext,
  weight: number,
): { triggered: boolean; score: number; detail: string } {
  switch (ruleType) {
    case "velocity": {
      const maxCount = (config["maxPayments"] as number | undefined) ?? 5;
      const triggered = context.customerPaymentCount >= maxCount;
      return {
        triggered,
        score: triggered ? weight : 0,
        detail: triggered
          ? `${context.customerPaymentCount} payments in window (max: ${maxCount})`
          : `${context.customerPaymentCount} payments within limit`,
      };
    }
    case "amount_anomaly": {
      const multiplier = (config["multiplier"] as number | undefined) ?? 3;
      const triggered = context.customerAvgAmount > 0 && payment.amount > context.customerAvgAmount * multiplier;
      return {
        triggered,
        score: triggered ? weight : 0,
        detail: triggered
          ? `Amount ${payment.amount} exceeds ${multiplier}x avg ${context.customerAvgAmount}`
          : `Amount within normal range`,
      };
    }
    case "high_value": {
      const threshold = (config["thresholdCents"] as number | undefined) ?? 100_000;
      const triggered = payment.amount > threshold;
      return {
        triggered,
        score: triggered ? weight : 0,
        detail: triggered
          ? `Amount ${payment.amount} exceeds threshold ${threshold}`
          : `Amount below threshold`,
      };
    }
    case "geo_mismatch": {
      const region = payment.region ?? "US";
      const triggered = context.customerRegion !== "" && context.customerRegion !== region;
      return {
        triggered,
        score: triggered ? weight : 0,
        detail: triggered
          ? `Region mismatch: payment=${region}, customer=${context.customerRegion}`
          : `Region matches`,
      };
    }
    case "new_customer": {
      const triggered = context.customerPaymentCount === 0;
      return {
        triggered,
        score: triggered ? weight : 0,
        detail: triggered ? "First payment from customer" : "Returning customer",
      };
    }
    default:
      return { triggered: false, score: 0, detail: `Unknown rule type: ${ruleType}` };
  }
}

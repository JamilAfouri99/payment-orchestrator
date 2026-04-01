import type { PrismaClient } from "@prisma/client";
import { v4 as uuid } from "uuid";
import type { Logger } from "../core/logger.js";

const DEFAULT_RULES = [
  {
    name: "Velocity Check",
    description: "Flag if customer exceeds payment count in time window",
    ruleType: "velocity",
    config: { maxPayments: 5, windowMinutes: 10 },
    weight: 30,
  },
  {
    name: "Amount Anomaly",
    description: "Flag if amount exceeds 3x customer average",
    ruleType: "amount_anomaly",
    config: { multiplier: 3 },
    weight: 25,
  },
  {
    name: "High Value Transaction",
    description: "Flag transactions over $1000",
    ruleType: "high_value",
    config: { thresholdCents: 100_000 },
    weight: 15,
  },
  {
    name: "Geographic Mismatch",
    description: "Flag if payment region differs from customer usual region",
    ruleType: "geo_mismatch",
    config: {},
    weight: 20,
  },
  {
    name: "New Customer",
    description: "Flag first-time customers",
    ruleType: "new_customer",
    config: {},
    weight: 10,
  },
];

export async function seedDefaultFraudRules(prisma: PrismaClient, logger: Logger): Promise<void> {
  const existing = await prisma.fraudRule.count();
  if (existing > 0) return;

  for (const rule of DEFAULT_RULES) {
    await prisma.fraudRule.create({
      data: {
        id: uuid(),
        name: rule.name,
        description: rule.description,
        ruleType: rule.ruleType,
        config: rule.config,
        weight: rule.weight,
        enabled: true,
      },
    });
  }

  logger.info("fraud_rules_seeded", { count: DEFAULT_RULES.length });
}

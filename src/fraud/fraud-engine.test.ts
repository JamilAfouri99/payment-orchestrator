import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFraudEngine, type FraudRuleRecord, type FraudContext } from "./fraud-engine.js";
import type { PaymentRequest } from "../core/types.js";

function makePayment(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    amount: 5_000,
    currency: "USD",
    customerId: "cust_1",
    orderId: "ord_1",
    items: [{ productId: "p1", quantity: 1, pricePerUnit: 5_000 }],
    region: "US",
    ...overrides,
  };
}

function makeContext(overrides: Partial<FraudContext> = {}): FraudContext {
  return {
    customerPaymentCount: 3,
    customerAvgAmount: 4_000,
    customerRegion: "US",
    ...overrides,
  };
}

type PrismaFraudRule = {
  id: string;
  name: string;
  description: string;
  ruleType: string;
  config: object;
  weight: number;
  enabled: boolean;
};

function makePrismaRule(overrides: Partial<PrismaFraudRule> = {}): PrismaFraudRule {
  return {
    id: `rule_${Math.random().toString(36).slice(2)}`,
    name: "Test Rule",
    description: "A test rule",
    ruleType: "velocity",
    config: { maxPayments: 5 },
    weight: 40,
    enabled: true,
    ...overrides,
  };
}

function createMockPrisma(rules: PrismaFraudRule[] = []) {
  const ruleStore: PrismaFraudRule[] = [...rules];

  return {
    fraudRule: {
      findMany: vi.fn().mockImplementation(async ({ where }: { where?: { enabled?: boolean } } = {}) => {
        if (where?.enabled !== undefined) {
          return ruleStore.filter((r) => r.enabled === where.enabled);
        }
        return [...ruleStore];
      }),
      upsert: vi.fn().mockImplementation(async ({ where, create }: { where: { id: string }; create: PrismaFraudRule }) => {
        const existing = ruleStore.findIndex((r) => r.id === where.id);
        if (existing >= 0) {
          ruleStore[existing] = { ...ruleStore[existing]!, ...create };
          return ruleStore[existing]!;
        }
        ruleStore.push(create);
        return create;
      }),
      delete: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        const idx = ruleStore.findIndex((r) => r.id === where.id);
        if (idx < 0) throw new Error("Record not found");
        const deleted = ruleStore.splice(idx, 1)[0]!;
        return deleted;
      }),
    },
    fraudEvaluation: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as import("@prisma/client").PrismaClient;
}

describe("FraudEngine — velocity rule", () => {
  it("triggers when payment count meets or exceeds maxPayments", async () => {
    const prisma = createMockPrisma([
      makePrismaRule({ ruleType: "velocity", config: { maxPayments: 3 }, weight: 50 }),
    ]);
    const engine = createFraudEngine(prisma);

    const result = await engine.evaluate(makePayment(), makeContext({ customerPaymentCount: 3 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const velocityResult = result.value.ruleResults.find((r) => r.ruleType === "velocity");
    expect(velocityResult!.triggered).toBe(true);
    expect(velocityResult!.score).toBe(50);
  });

  it("does not trigger when payment count is below maxPayments", async () => {
    const prisma = createMockPrisma([
      makePrismaRule({ ruleType: "velocity", config: { maxPayments: 5 }, weight: 50 }),
    ]);
    const engine = createFraudEngine(prisma);

    const result = await engine.evaluate(makePayment(), makeContext({ customerPaymentCount: 2 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const velocityResult = result.value.ruleResults.find((r) => r.ruleType === "velocity");
    expect(velocityResult!.triggered).toBe(false);
    expect(velocityResult!.score).toBe(0);
  });
});

describe("FraudEngine — amount_anomaly rule", () => {
  it("triggers when payment amount exceeds multiplier times customer average", async () => {
    const prisma = createMockPrisma([
      makePrismaRule({ ruleType: "amount_anomaly", config: { multiplier: 3 }, weight: 40 }),
    ]);
    const engine = createFraudEngine(prisma);

    // avg=1000, multiplier=3 → threshold=3000; payment.amount=4000 → triggers
    const result = await engine.evaluate(
      makePayment({ amount: 4_000 }),
      makeContext({ customerAvgAmount: 1_000 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ruleResult = result.value.ruleResults.find((r) => r.ruleType === "amount_anomaly");
    expect(ruleResult!.triggered).toBe(true);
  });

  it("does not trigger when payment amount is within the multiplier range", async () => {
    const prisma = createMockPrisma([
      makePrismaRule({ ruleType: "amount_anomaly", config: { multiplier: 3 }, weight: 40 }),
    ]);
    const engine = createFraudEngine(prisma);

    const result = await engine.evaluate(
      makePayment({ amount: 2_000 }),
      makeContext({ customerAvgAmount: 1_000 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ruleResult = result.value.ruleResults.find((r) => r.ruleType === "amount_anomaly");
    expect(ruleResult!.triggered).toBe(false);
  });

  it("does not trigger when customerAvgAmount is zero", async () => {
    const prisma = createMockPrisma([
      makePrismaRule({ ruleType: "amount_anomaly", config: { multiplier: 3 }, weight: 40 }),
    ]);
    const engine = createFraudEngine(prisma);

    const result = await engine.evaluate(
      makePayment({ amount: 999_999 }),
      makeContext({ customerAvgAmount: 0 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ruleResult = result.value.ruleResults.find((r) => r.ruleType === "amount_anomaly");
    expect(ruleResult!.triggered).toBe(false);
  });
});

describe("FraudEngine — high_value rule", () => {
  it("triggers when amount exceeds the configured threshold", async () => {
    const prisma = createMockPrisma([
      makePrismaRule({ ruleType: "high_value", config: { thresholdCents: 50_000 }, weight: 60 }),
    ]);
    const engine = createFraudEngine(prisma);

    const result = await engine.evaluate(makePayment({ amount: 100_000 }), makeContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ruleResult = result.value.ruleResults.find((r) => r.ruleType === "high_value");
    expect(ruleResult!.triggered).toBe(true);
    expect(ruleResult!.score).toBe(60);
  });

  it("does not trigger when amount is at or below the threshold", async () => {
    const prisma = createMockPrisma([
      makePrismaRule({ ruleType: "high_value", config: { thresholdCents: 100_000 }, weight: 60 }),
    ]);
    const engine = createFraudEngine(prisma);

    const result = await engine.evaluate(makePayment({ amount: 50_000 }), makeContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ruleResult = result.value.ruleResults.find((r) => r.ruleType === "high_value");
    expect(ruleResult!.triggered).toBe(false);
  });
});

describe("FraudEngine — score thresholds and actions", () => {
  it("returns allow action when total score is at or below 30", async () => {
    const prisma = createMockPrisma([
      // weight=20, not triggered → score stays at 0
      makePrismaRule({ ruleType: "high_value", config: { thresholdCents: 1_000_000 }, weight: 20 }),
    ]);
    const engine = createFraudEngine(prisma);

    const result = await engine.evaluate(makePayment({ amount: 100 }), makeContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.score).toBeLessThanOrEqual(30);
    expect(result.value.action).toBe("allow");
  });

  it("returns review action when score is between 31 and 70", async () => {
    const prisma = createMockPrisma([
      makePrismaRule({ ruleType: "high_value", config: { thresholdCents: 1 }, weight: 50 }),
    ]);
    const engine = createFraudEngine(prisma);

    const result = await engine.evaluate(makePayment({ amount: 1_000 }), makeContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.score).toBeGreaterThan(30);
    expect(result.value.score).toBeLessThanOrEqual(70);
    expect(result.value.action).toBe("review");
  });

  it("returns block action when total score exceeds 70", async () => {
    const prisma = createMockPrisma([
      makePrismaRule({ ruleType: "high_value", config: { thresholdCents: 1 }, weight: 80 }),
    ]);
    const engine = createFraudEngine(prisma);

    const result = await engine.evaluate(makePayment({ amount: 1_000 }), makeContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.score).toBeGreaterThan(70);
    expect(result.value.action).toBe("block");
  });

  it("caps total score at 100 when multiple rules trigger", async () => {
    const prisma = createMockPrisma([
      makePrismaRule({ ruleType: "high_value", config: { thresholdCents: 1 }, weight: 80 }),
      makePrismaRule({ ruleType: "velocity", config: { maxPayments: 1 }, weight: 80 }),
    ]);
    const engine = createFraudEngine(prisma);

    const result = await engine.evaluate(makePayment({ amount: 1_000 }), makeContext({ customerPaymentCount: 5 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.score).toBe(100);
  });
});

describe("FraudEngine — disabled rules", () => {
  it("skips rules that are disabled", async () => {
    const prisma = createMockPrisma([
      makePrismaRule({ ruleType: "high_value", config: { thresholdCents: 1 }, weight: 80, enabled: false }),
    ]);
    const engine = createFraudEngine(prisma);

    const result = await engine.evaluate(makePayment({ amount: 1_000 }), makeContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only enabled rules are fetched; disabled rule must not affect score
    expect(result.value.score).toBe(0);
    expect(result.value.action).toBe("allow");
  });

  it("queries only enabled rules from the database", async () => {
    const prisma = createMockPrisma();
    const engine = createFraudEngine(prisma);

    await engine.evaluate(makePayment(), makeContext());

    expect(prisma.fraudRule.findMany).toHaveBeenCalledWith({ where: { enabled: true } });
  });
});

describe("FraudEngine — evaluate error handling", () => {
  it("returns EVALUATION_FAILED when the database throws", async () => {
    const prisma = createMockPrisma();
    (prisma.fraudRule.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DB error"));
    const engine = createFraudEngine(prisma);

    const result = await engine.evaluate(makePayment(), makeContext());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EVALUATION_FAILED");
  });
});

describe("FraudEngine — evaluate returns ruleResults for every active rule", () => {
  it("includes one result entry per active rule", async () => {
    const prisma = createMockPrisma([
      makePrismaRule({ ruleType: "velocity", config: { maxPayments: 5 }, weight: 20 }),
      makePrismaRule({ ruleType: "high_value", config: { thresholdCents: 999_999 }, weight: 30 }),
    ]);
    const engine = createFraudEngine(prisma);

    const result = await engine.evaluate(makePayment(), makeContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ruleResults).toHaveLength(2);
  });

  it("includes evaluatedAt timestamp in ISO format", async () => {
    const prisma = createMockPrisma([]);
    const engine = createFraudEngine(prisma);

    const result = await engine.evaluate(makePayment(), makeContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => new Date(result.value.evaluatedAt)).not.toThrow();
    expect(result.value.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

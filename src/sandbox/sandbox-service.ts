import type { PrismaClient } from "@prisma/client";
import { type Result, ok, err } from "../core/result.js";

export class SandboxError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_SANDBOX" | "NOT_FOUND" | "INVALID_CARD" | "SIMULATION_FAILED",
  ) {
    super(message);
    this.name = "SandboxError";
  }
}

export type TestCardBehavior =
  | "success"
  | "decline_insufficient_funds"
  | "3ds_challenge"
  | "timeout"
  | "fraud_block"
  | "success_then_dispute"
  | "soft_decline_retry";

export interface TestCardInfo {
  number: string;
  behavior: TestCardBehavior;
  description: string;
  declineCode?: string | undefined;
}

export interface SandboxPaymentResult {
  success: boolean;
  behavior: TestCardBehavior;
  providerResponse: {
    status: string;
    declineCode?: string | undefined;
    fraudScore?: number | undefined;
    threeDSecureRequired?: boolean | undefined;
    error?: string | undefined;
  };
  retryable: boolean;
}

const TEST_CARDS: TestCardInfo[] = [
  {
    number: "4242424242424242",
    behavior: "success",
    description: "Always succeeds. Standard success flow through the full saga.",
  },
  {
    number: "4000000000000002",
    behavior: "decline_insufficient_funds",
    description: "Always declines with insufficient funds. Hard decline — no retry.",
    declineCode: "insufficient_funds",
  },
  {
    number: "4000000000003220",
    behavior: "3ds_challenge",
    description: "Triggers 3D Secure challenge. Payment requires authentication before processing.",
  },
  {
    number: "4000000000000069",
    behavior: "timeout",
    description: "Simulates a provider timeout during processing. Payment enters failed state.",
  },
  {
    number: "4000000000000127",
    behavior: "fraud_block",
    description: "Triggers fraud block. Fraud score evaluates above threshold, payment is rejected.",
  },
  {
    number: "4000000000004954",
    behavior: "success_then_dispute",
    description: "Payment succeeds initially, then a dispute is created after 30 seconds.",
  },
  {
    number: "4000000000009995",
    behavior: "soft_decline_retry",
    description: "First attempt soft-declines (insufficient funds). Succeeds on automatic retry.",
    declineCode: "insufficient_funds",
  },
];

const TEST_CARD_MAP = new Map<string, TestCardInfo>();
for (const card of TEST_CARDS) {
  TEST_CARD_MAP.set(card.number, card);
}

export interface SandboxService {
  isTestCard(pan: string): boolean;
  getTestCardBehavior(pan: string): TestCardBehavior | null;
  getTestCardInfo(pan: string): TestCardInfo | null;
  simulatePayment(pan: string, amount: number): SandboxPaymentResult;
  triggerDispute(paymentId: string): Promise<Result<{ disputeId: string; paymentId: string }, SandboxError>>;
  getTestCards(): TestCardInfo[];
  resetSandboxData(): Promise<Result<{ deleted: number }, SandboxError>>;
}

export function createSandboxService(prisma: PrismaClient, tenantId: string): SandboxService {
  return {
    isTestCard(pan: string): boolean {
      const stripped = pan.replace(/\s+/g, "");
      return TEST_CARD_MAP.has(stripped);
    },

    getTestCardBehavior(pan: string): TestCardBehavior | null {
      const stripped = pan.replace(/\s+/g, "");
      return TEST_CARD_MAP.get(stripped)?.behavior ?? null;
    },

    getTestCardInfo(pan: string): TestCardInfo | null {
      const stripped = pan.replace(/\s+/g, "");
      return TEST_CARD_MAP.get(stripped) ?? null;
    },

    simulatePayment(pan: string, amount: number): SandboxPaymentResult {
      const stripped = pan.replace(/\s+/g, "");
      const card = TEST_CARD_MAP.get(stripped);

      if (!card) {
        return {
          success: true,
          behavior: "success",
          providerResponse: { status: "succeeded" },
          retryable: false,
        };
      }

      switch (card.behavior) {
        case "success":
          return {
            success: true,
            behavior: "success",
            providerResponse: { status: "succeeded" },
            retryable: false,
          };

        case "decline_insufficient_funds":
          return {
            success: false,
            behavior: "decline_insufficient_funds",
            providerResponse: {
              status: "declined",
              declineCode: "insufficient_funds",
            },
            retryable: false,
          };

        case "3ds_challenge":
          return {
            success: false,
            behavior: "3ds_challenge",
            providerResponse: {
              status: "requires_action",
              threeDSecureRequired: true,
            },
            retryable: false,
          };

        case "timeout":
          return {
            success: false,
            behavior: "timeout",
            providerResponse: {
              status: "failed",
              error: "Provider timeout after 30000ms",
            },
            retryable: true,
          };

        case "fraud_block":
          return {
            success: false,
            behavior: "fraud_block",
            providerResponse: {
              status: "blocked",
              fraudScore: 95,
            },
            retryable: false,
          };

        case "success_then_dispute":
          return {
            success: true,
            behavior: "success_then_dispute",
            providerResponse: { status: "succeeded" },
            retryable: false,
          };

        case "soft_decline_retry": {
          // Deterministic: amounts ending in even cents succeed on "retry"
          const isRetry = amount % 2 === 0;
          if (isRetry) {
            return {
              success: true,
              behavior: "soft_decline_retry",
              providerResponse: { status: "succeeded" },
              retryable: false,
            };
          }
          return {
            success: false,
            behavior: "soft_decline_retry",
            providerResponse: {
              status: "declined",
              declineCode: "insufficient_funds",
            },
            retryable: true,
          };
        }
      }
    },

    async triggerDispute(paymentId: string): Promise<Result<{ disputeId: string; paymentId: string }, SandboxError>> {
      try {
        const events = await prisma.eventStore.findMany({
          where: { tenantId, aggregateId: paymentId },
          take: 1,
        });

        if (events.length === 0) {
          return err(new SandboxError(`Payment ${paymentId} not found`, "NOT_FOUND"));
        }

        const dispute = await prisma.dispute.create({
          data: {
            tenantId,
            paymentId,
            externalDisputeId: `sandbox_${Date.now()}`,
            reason: "fraudulent",
            amount: 0,
            currency: "USD",
            type: "chargeback",
            status: "needs_response",
            evidenceDueBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            filedAt: new Date(),
          },
        });

        return ok({ disputeId: dispute.id, paymentId });
      } catch (error) {
        return err(
          new SandboxError(
            `Failed to trigger dispute: ${error instanceof Error ? error.message : String(error)}`,
            "SIMULATION_FAILED",
          ),
        );
      }
    },

    getTestCards(): TestCardInfo[] {
      return [...TEST_CARDS];
    },

    async resetSandboxData(): Promise<Result<{ deleted: number }, SandboxError>> {
      try {
        let deleted = 0;

        const sagaResult = await prisma.sagaExecution.deleteMany({
          where: { tenantId },
        });
        deleted += sagaResult.count;

        const eventResult = await prisma.eventStore.deleteMany({
          where: { tenantId },
        });
        deleted += eventResult.count;

        const snapshotResult = await prisma.eventSnapshot.deleteMany({
          where: { tenantId },
        });
        deleted += snapshotResult.count;

        return ok({ deleted });
      } catch (error) {
        return err(
          new SandboxError(
            `Failed to reset sandbox data: ${error instanceof Error ? error.message : String(error)}`,
            "SIMULATION_FAILED",
          ),
        );
      }
    },
  };
}

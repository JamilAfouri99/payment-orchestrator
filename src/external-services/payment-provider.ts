import { type Result, ok, err } from "../core/result.js";
import type { Cents } from "../core/types.js";

export interface ChargeResult {
  transactionId: string;
  amount: Cents;
  status: "charged";
}

export interface RefundResult {
  transactionId: string;
  amount: Cents;
  status: "refunded";
}

/**
 * Simulated payment provider with configurable failure rate and realistic delays.
 * @param failureRate - Probability of failure (0.0 to 1.0)
 * @returns Object with charge and refund methods
 */
export function createPaymentProvider(failureRate: number) {
  return {
    /**
     * Charges the given amount. Simulates network latency.
     * @param amount - Amount in cents
     * @param customerId - Customer identifier
     * @returns Charge result or error
     */
    async charge(amount: Cents, customerId: string): Promise<Result<ChargeResult, Error>> {
      await simulateLatency(50, 200);
      if (Math.random() < failureRate) {
        return err(new Error(`Payment provider: charge failed for customer ${customerId}`));
      }
      return ok({
        transactionId: `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        amount,
        status: "charged" as const,
      });
    },

    /**
     * Refunds a previous charge.
     * @param transactionId - The original transaction to refund
     * @param amount - Amount in cents to refund
     * @returns Refund result or error
     */
    async refund(transactionId: string, amount: Cents): Promise<Result<RefundResult, Error>> {
      await simulateLatency(50, 150);
      if (Math.random() < failureRate * 0.5) {
        return err(new Error(`Payment provider: refund failed for transaction ${transactionId}`));
      }
      return ok({
        transactionId: `ref_${transactionId}`,
        amount,
        status: "refunded" as const,
      });
    },
  };
}

export type PaymentProvider = ReturnType<typeof createPaymentProvider>;

function simulateLatency(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

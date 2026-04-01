import { type Result, ok, err } from "../core/result.js";
import type { Cents } from "../core/types.js";
import type { ChaosController } from "../chaos/chaos-controller.js";

export const SERVICE_NAME = "payment-provider";

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
 * Simulated payment provider driven by the chaos controller for runtime failure injection.
 * @param chaos - Chaos controller for dynamic failure rates
 * @returns Object with charge and refund methods
 */
export function createPaymentProvider(chaos: ChaosController) {
  return {
    /**
     * Charges the given amount. Simulates network latency.
     * @param amount - Amount in cents
     * @param customerId - Customer identifier
     * @returns Charge result or error
     */
    async charge(amount: Cents, customerId: string): Promise<Result<ChargeResult, Error>> {
      await chaos.simulateLatency(SERVICE_NAME, 50, 200);
      if (chaos.shouldFail(SERVICE_NAME)) {
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
      await chaos.simulateLatency(SERVICE_NAME, 50, 150);
      if (Math.random() < chaos.getFailureRate(SERVICE_NAME) * 0.5) {
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

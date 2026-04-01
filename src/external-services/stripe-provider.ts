import { type Result, ok, err } from "../core/result.js";
import type { Cents } from "../core/types.js";
import type { ChaosController } from "../chaos/chaos-controller.js";
import { type ChargeAdapterResult, type RefundAdapterResult, ProviderError } from "../routing/provider-registry.js";
import { randomDeclineCode } from "../retry/decline-codes.js";

export const SERVICE_NAME = "stripe";

export function createStripeProvider(chaos: ChaosController) {
  return {
    async charge(amount: Cents, customerId: string): Promise<Result<ChargeAdapterResult, ProviderError>> {
      await chaos.simulateLatency(SERVICE_NAME, 40, 180);
      if (chaos.shouldFail(SERVICE_NAME)) {
        const code = randomDeclineCode();
        return err(new ProviderError(
          `Stripe: charge failed for customer ${customerId} (${code})`,
          SERVICE_NAME,
          code,
        ));
      }
      return ok({
        transactionId: `stripe_txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        amount,
        status: "charged" as const,
        providerId: SERVICE_NAME,
      });
    },

    async refund(transactionId: string, amount: Cents): Promise<Result<RefundAdapterResult, ProviderError>> {
      await chaos.simulateLatency(SERVICE_NAME, 40, 150);
      if (Math.random() < chaos.getFailureRate(SERVICE_NAME) * 0.5) {
        return err(new ProviderError(
          `Stripe: refund failed for ${transactionId}`,
          SERVICE_NAME,
          "refund_failed",
        ));
      }
      return ok({
        transactionId: `stripe_ref_${transactionId}`,
        amount,
        status: "refunded" as const,
        providerId: SERVICE_NAME,
      });
    },
  };
}

export type StripeProvider = ReturnType<typeof createStripeProvider>;

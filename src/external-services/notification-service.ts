import { type Result, ok, err } from "../core/result.js";

export interface NotificationResult {
  notificationId: string;
  channel: string;
}

/**
 * Simulated notification service with configurable failure rate.
 * @param failureRate - Probability of failure (0.0 to 1.0)
 * @returns Object with a send method
 */
export function createNotificationService(failureRate: number) {
  return {
    /**
     * Sends a payment confirmation notification.
     * @param customerId - Customer to notify
     * @param message - Notification content
     * @returns Notification confirmation or error
     */
    async send(customerId: string, _message: string): Promise<Result<NotificationResult, Error>> {
      await simulateLatency(20, 60);
      if (Math.random() < failureRate) {
        return err(new Error(`Notification service: failed to notify customer ${customerId}`));
      }
      return ok({
        notificationId: `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        channel: "email",
      });
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;

function simulateLatency(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

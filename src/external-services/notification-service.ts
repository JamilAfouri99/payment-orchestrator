import { type Result, ok, err } from "../core/result.js";
import type { ChaosController } from "../chaos/chaos-controller.js";

export const SERVICE_NAME = "notification-service";

export interface NotificationResult {
  notificationId: string;
  channel: string;
}

/**
 * Simulated notification service driven by the chaos controller.
 * @param chaos - Chaos controller for dynamic failure rates
 * @returns Object with a send method
 */
export function createNotificationService(chaos: ChaosController) {
  return {
    /**
     * Sends a payment confirmation notification.
     * @param customerId - Customer to notify
     * @param _message - Notification content
     * @returns Notification confirmation or error
     */
    async send(customerId: string, _message: string): Promise<Result<NotificationResult, Error>> {
      await chaos.simulateLatency(SERVICE_NAME, 20, 60);
      if (chaos.shouldFail(SERVICE_NAME)) {
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

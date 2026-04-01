import { type Result, ok, err } from "../core/result.js";
import type { OrderItem } from "../core/types.js";
import type { ChaosController } from "../chaos/chaos-controller.js";

export const SERVICE_NAME = "inventory-service";

export interface ReservationResult {
  reservationId: string;
  items: OrderItem[];
}

/**
 * Simulated inventory service driven by the chaos controller.
 * @param chaos - Chaos controller for dynamic failure rates
 * @returns Object with reserve and release methods
 */
export function createInventoryService(chaos: ChaosController) {
  return {
    /**
     * Reserves inventory for the given items.
     * @param items - Line items to reserve
     * @returns Reservation confirmation or error
     */
    async reserve(items: OrderItem[]): Promise<Result<ReservationResult, Error>> {
      await chaos.simulateLatency(SERVICE_NAME, 30, 100);
      if (chaos.shouldFail(SERVICE_NAME)) {
        return err(new Error("Inventory service: insufficient stock"));
      }
      return ok({
        reservationId: `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        items,
      });
    },

    /**
     * Releases a previous reservation (compensation).
     * @param reservationId - The reservation to release
     * @returns Success or error
     */
    async release(reservationId: string): Promise<Result<void, Error>> {
      await chaos.simulateLatency(SERVICE_NAME, 20, 80);
      if (Math.random() < chaos.getFailureRate(SERVICE_NAME) * 0.3) {
        return err(new Error(`Inventory service: failed to release reservation ${reservationId}`));
      }
      return ok(undefined);
    },
  };
}

export type InventoryService = ReturnType<typeof createInventoryService>;

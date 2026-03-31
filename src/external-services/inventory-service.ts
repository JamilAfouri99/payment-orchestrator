import { type Result, ok, err } from "../core/result.js";
import type { OrderItem } from "../core/types.js";

export interface ReservationResult {
  reservationId: string;
  items: OrderItem[];
}

/**
 * Simulated inventory service with configurable failure rate.
 * @param failureRate - Probability of failure (0.0 to 1.0)
 * @returns Object with reserve and release methods
 */
export function createInventoryService(failureRate: number) {
  return {
    /**
     * Reserves inventory for the given items.
     * @param items - Line items to reserve
     * @returns Reservation confirmation or error
     */
    async reserve(items: OrderItem[]): Promise<Result<ReservationResult, Error>> {
      await simulateLatency(30, 100);
      if (Math.random() < failureRate) {
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
      await simulateLatency(20, 80);
      if (Math.random() < failureRate * 0.3) {
        return err(new Error(`Inventory service: failed to release reservation ${reservationId}`));
      }
      return ok(undefined);
    },
  };
}

export type InventoryService = ReturnType<typeof createInventoryService>;

function simulateLatency(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

import { type Result, err } from "../core/result.js";

export class BulkheadError extends Error {
  constructor(
    message: string,
    public readonly service: string,
  ) {
    super(message);
    this.name = "BulkheadError";
  }
}

export interface BulkheadOptions {
  /** Maximum concurrent executions allowed */
  maxConcurrent: number;
  /** Maximum queue size for waiting requests */
  maxQueue: number;
  /** Name for identification */
  name: string;
}

export interface Bulkhead {
  /**
   * Executes a function within the bulkhead's concurrency limit.
   * Rejects immediately if both the execution pool and queue are full.
   * @param fn - The async operation to protect
   * @returns The operation result or a bulkhead rejection error
   */
  execute<T>(fn: () => Promise<Result<T, Error>>): Promise<Result<T, Error | BulkheadError>>;

  /** @returns Current concurrency stats */
  getStats(): BulkheadStats;
}

export interface BulkheadStats {
  name: string;
  maxConcurrent: number;
  maxQueue: number;
  activeCount: number;
  queueSize: number;
  availableSlots: number;
}

/**
 * Creates a bulkhead that limits concurrent access to a resource.
 * Prevents a slow service from consuming all available threads.
 * @param options - Concurrency configuration
 * @returns Bulkhead instance
 */
export function createBulkhead(options: BulkheadOptions): Bulkhead {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  function tryDequeue(): void {
    if (queue.length > 0 && activeCount < options.maxConcurrent) {
      activeCount++;
      const next = queue.shift()!;
      next();
    }
  }

  return {
    async execute<T>(fn: () => Promise<Result<T, Error>>): Promise<Result<T, Error | BulkheadError>> {
      if (activeCount >= options.maxConcurrent) {
        if (queue.length >= options.maxQueue) {
          return err(
            new BulkheadError(
              `Bulkhead "${options.name}" rejected: ${activeCount} active, ${queue.length} queued`,
              options.name,
            ),
          );
        }

        await new Promise<void>((resolve) => {
          queue.push(resolve);
        });
      } else {
        activeCount++;
      }

      try {
        return await fn();
      } finally {
        activeCount--;
        tryDequeue();
      }
    },

    getStats() {
      return {
        name: options.name,
        maxConcurrent: options.maxConcurrent,
        maxQueue: options.maxQueue,
        activeCount,
        queueSize: queue.length,
        availableSlots: Math.max(0, options.maxConcurrent - activeCount),
      };
    },
  };
}

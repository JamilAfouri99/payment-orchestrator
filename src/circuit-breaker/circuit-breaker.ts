import { type Result, err } from "../core/result.js";

export type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly state: CircuitState,
  ) {
    super(message);
    this.name = "CircuitBreakerError";
  }
}

export interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms before moving from open to half-open */
  timeoutMs: number;
  /** Name for logging/identification */
  name: string;
}

interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
  successCount: number;
}

export interface CircuitBreaker {
  /**
   * Executes a function through the circuit breaker.
   * @param fn - The async operation to protect
   * @returns The operation result or a circuit breaker error
   */
  execute<T>(fn: () => Promise<Result<T, Error>>): Promise<Result<T, Error | CircuitBreakerError>>;

  /** @returns Current circuit state for monitoring */
  getState(): CircuitState;

  /** Resets the circuit breaker to closed state */
  reset(): void;
}

/**
 * Creates a circuit breaker with three states: closed, open, half-open.
 * Includes exponential backoff with jitter for the open→half-open transition.
 * @param options - Configuration for failure threshold and timeout
 * @returns CircuitBreaker instance
 */
export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  const internal: CircuitBreakerState = {
    state: "closed",
    failureCount: 0,
    lastFailureTime: 0,
    successCount: 0,
  };

  function shouldTransitionToHalfOpen(): boolean {
    if (internal.state !== "open") return false;
    const backoffMs = calculateBackoff(internal.failureCount, options.timeoutMs);
    return Date.now() - internal.lastFailureTime >= backoffMs;
  }

  function recordFailure(): void {
    internal.failureCount++;
    internal.lastFailureTime = Date.now();
    internal.successCount = 0;

    if (internal.failureCount >= options.failureThreshold) {
      internal.state = "open";
    }
  }

  function recordSuccess(): void {
    if (internal.state === "half-open") {
      internal.state = "closed";
      internal.failureCount = 0;
      internal.successCount = 0;
    } else {
      internal.successCount++;
    }
  }

  return {
    async execute<T>(fn: () => Promise<Result<T, Error>>): Promise<Result<T, Error | CircuitBreakerError>> {
      if (internal.state === "open") {
        if (shouldTransitionToHalfOpen()) {
          internal.state = "half-open";
        } else {
          return err(
            new CircuitBreakerError(
              `Circuit breaker "${options.name}" is open — request rejected`,
              "open",
            ),
          );
        }
      }

      const result = await fn();

      if (result.ok) {
        recordSuccess();
      } else {
        recordFailure();
      }

      return result;
    },

    getState(): CircuitState {
      if (internal.state === "open" && shouldTransitionToHalfOpen()) {
        return "half-open";
      }
      return internal.state;
    },

    reset(): void {
      internal.state = "closed";
      internal.failureCount = 0;
      internal.lastFailureTime = 0;
      internal.successCount = 0;
    },
  };
}

/**
 * Calculates exponential backoff with jitter.
 * @param attempt - Current failure count
 * @param baseMs - Base timeout in milliseconds
 * @returns Backoff duration in milliseconds
 */
export function calculateBackoff(attempt: number, baseMs: number): number {
  const exponential = baseMs * Math.pow(2, Math.min(attempt - 1, 5));
  const jitter = exponential * 0.1 * Math.random();
  return exponential + jitter;
}

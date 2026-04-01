import {
  createCircuitBreaker,
  type CircuitBreaker,
  type CircuitBreakerOptions,
  type CircuitState,
} from "./circuit-breaker.js";

export interface CircuitBreakerInfo {
  name: string;
  state: CircuitState;
}

export interface CircuitBreakerRegistry {
  /** Creates and registers a new circuit breaker */
  create(options: CircuitBreakerOptions): CircuitBreaker;

  /** @returns A named circuit breaker or undefined */
  get(name: string): CircuitBreaker | undefined;

  /** @returns Status of all registered circuit breakers */
  getAll(): CircuitBreakerInfo[];

  /** Resets a specific circuit breaker by name */
  reset(name: string): boolean;

  /** Resets all circuit breakers */
  resetAll(): void;
}

/**
 * Creates a registry that manages all circuit breaker instances.
 * Provides a single point to monitor and control all breakers.
 * @returns CircuitBreakerRegistry instance
 */
export function createCircuitBreakerRegistry(): CircuitBreakerRegistry {
  const breakers = new Map<string, CircuitBreaker>();

  return {
    create(options) {
      const cb = createCircuitBreaker(options);
      breakers.set(options.name, cb);
      return cb;
    },

    get(name) {
      return breakers.get(name);
    },

    getAll() {
      return Array.from(breakers.entries()).map(([name, cb]) => ({
        name,
        state: cb.getState(),
      }));
    },

    reset(name) {
      const cb = breakers.get(name);
      if (!cb) return false;
      cb.reset();
      return true;
    },

    resetAll() {
      for (const cb of breakers.values()) {
        cb.reset();
      }
    },
  };
}

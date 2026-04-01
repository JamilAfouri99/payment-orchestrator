/**
 * Runtime failure injection for chaos engineering.
 * Allows failure rates to be modified at runtime via the admin API
 * without restarting the service.
 */
export interface ServiceChaosConfig {
  failureRate: number;
  latencyMs: number;
  enabled: boolean;
}

export interface ChaosController {
  /** @returns Current failure rate for a service (0.0 - 1.0) */
  getFailureRate(service: string): number;

  /** @returns Current additional latency in ms for a service */
  getLatency(service: string): number;

  /** @returns Whether chaos is enabled for a service */
  isEnabled(service: string): boolean;

  /** Updates chaos configuration for a service */
  setConfig(service: string, config: Partial<ServiceChaosConfig>): void;

  /** @returns Full configuration for all services */
  getAll(): Record<string, ServiceChaosConfig>;

  /** Resets all services to their initial configuration */
  reset(): void;

  /**
   * Evaluates whether a call should fail based on the service's failure rate.
   * @param service - Service name
   * @returns True if the call should be artificially failed
   */
  shouldFail(service: string): boolean;

  /**
   * Simulates configurable latency for a service.
   * @param service - Service name
   * @param baseMinMs - Base minimum latency
   * @param baseMaxMs - Base maximum latency
   */
  simulateLatency(service: string, baseMinMs: number, baseMaxMs: number): Promise<void>;
}

/**
 * Creates a chaos controller with initial per-service failure rates.
 * @param initialConfig - Map of service name to initial config
 * @returns ChaosController instance
 */
export function createChaosController(
  initialConfig: Record<string, Partial<ServiceChaosConfig>>,
): ChaosController {
  const defaults: ServiceChaosConfig = { failureRate: 0, latencyMs: 0, enabled: true };
  const config = new Map<string, ServiceChaosConfig>();
  const initial = new Map<string, ServiceChaosConfig>();

  for (const [name, cfg] of Object.entries(initialConfig)) {
    const full = { ...defaults, ...cfg };
    config.set(name, { ...full });
    initial.set(name, { ...full });
  }

  function getConfig(service: string): ServiceChaosConfig {
    return config.get(service) ?? defaults;
  }

  return {
    getFailureRate(service) {
      const cfg = getConfig(service);
      return cfg.enabled ? cfg.failureRate : 0;
    },

    getLatency(service) {
      const cfg = getConfig(service);
      return cfg.enabled ? cfg.latencyMs : 0;
    },

    isEnabled(service) {
      return getConfig(service).enabled;
    },

    setConfig(service, partial) {
      const existing = getConfig(service);
      config.set(service, { ...existing, ...partial });
    },

    getAll() {
      const result: Record<string, ServiceChaosConfig> = {};
      for (const [name, cfg] of config) {
        result[name] = { ...cfg };
      }
      return result;
    },

    reset() {
      config.clear();
      for (const [name, cfg] of initial) {
        config.set(name, { ...cfg });
      }
    },

    shouldFail(service) {
      return Math.random() < this.getFailureRate(service);
    },

    async simulateLatency(service, baseMinMs, baseMaxMs) {
      const extra = this.getLatency(service);
      const delay = baseMinMs + Math.random() * (baseMaxMs - baseMinMs) + extra;
      return new Promise((resolve) => setTimeout(resolve, delay));
    },
  };
}

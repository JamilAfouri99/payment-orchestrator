import { sleep } from "k6";
import { createPayment, checkHealth } from "../helpers/payment.js";
import { THRESHOLDS_RELAXED } from "../config.js";

/**
 * Scenario 3: Spike Test
 *
 * Ramps from 10 to 200 payments/sec in 30 seconds to test how the
 * system handles sudden load spikes. Validates that circuit breakers
 * and bulkheads protect the system.
 *
 * Run: k6 run load-tests/scenarios/spike.js
 */

export const options = {
  scenarios: {
    spike: {
      executor: "ramping-vus",
      startVUs: 10,
      stages: [
        { duration: "30s", target: 10 },    // Warm up at baseline
        { duration: "30s", target: 200 },    // Spike to 200 VUs in 30s
        { duration: "1m", target: 200 },     // Hold spike
        { duration: "30s", target: 10 },     // Return to baseline
        { duration: "1m", target: 10 },      // Recovery period
      ],
    },
    health_monitor: {
      executor: "constant-arrival-rate",
      rate: 2,
      timeUnit: "10s",
      duration: "3m30s",
      preAllocatedVUs: 2,
    },
  },
  thresholds: {
    ...THRESHOLDS_RELAXED,
    "http_req_duration{scenario:spike}": ["p(99)<3000"],
  },
};

export default function () {
  createPayment();
  sleep(0.1 + Math.random() * 0.3);
}

export function health_monitor() {
  checkHealth();
}

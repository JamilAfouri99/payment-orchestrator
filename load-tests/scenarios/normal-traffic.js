import { sleep } from "k6";
import { createPayment, listPayments, checkHealth } from "../helpers/payment.js";
import { THRESHOLDS } from "../config.js";

/**
 * Scenario 1: Normal Traffic
 *
 * Simulates steady-state traffic at 50 payments/sec for 5 minutes.
 * Validates all payments succeed with acceptable latency.
 *
 * Run: k6 run load-tests/scenarios/normal-traffic.js
 */

export const options = {
  scenarios: {
    payments: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },  // Ramp up to 50 VUs
        { duration: "5m", target: 50 },   // Hold at 50 VUs for 5 minutes
        { duration: "30s", target: 0 },   // Ramp down
      ],
      gracefulRampDown: "10s",
    },
    health_checks: {
      executor: "constant-arrival-rate",
      rate: 1,
      timeUnit: "10s",
      duration: "6m",
      preAllocatedVUs: 2,
    },
  },
  thresholds: THRESHOLDS,
};

export default function () {
  createPayment();
  sleep(0.5 + Math.random() * 0.5);
}

export function health_checks() {
  checkHealth();
  listPayments(5);
}

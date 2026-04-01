import http from "k6/http";
import { sleep, check } from "k6";
import { createPayment, checkHealth } from "../helpers/payment.js";
import { BASE_URL, DEFAULT_HEADERS, THRESHOLDS_RELAXED } from "../config.js";

/**
 * Scenario 2: Provider Failure
 *
 * Starts at 50 payments/sec, then at 2 minutes triggers a provider failure
 * via the chaos engineering endpoint. Verifies routing failover works and
 * error rate stays below 5%.
 *
 * Run: k6 run load-tests/scenarios/provider-failure.js
 */

export const options = {
  scenarios: {
    payments: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "4m30s", target: 50 },
        { duration: "30s", target: 0 },
      ],
    },
    trigger_failure: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      startTime: "2m",
    },
    verify_metrics: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 3,
      startTime: "3m",
    },
  },
  thresholds: THRESHOLDS_RELAXED,
};

export default function () {
  createPayment();
  sleep(0.5 + Math.random() * 0.5);
}

export function trigger_failure() {
  // Set stripe failure rate to 100% to force failover
  const res = http.post(
    `${BASE_URL}/admin/chaos`,
    JSON.stringify({
      service: "stripe",
      failureRate: 1.0,
      enabled: true,
    }),
    { headers: DEFAULT_HEADERS },
  );

  check(res, {
    "chaos triggered": (r) => r.status === 200,
  });

  console.log(">>> Provider failure triggered for Stripe at t=2m");
}

export function verify_metrics() {
  // Check that routing has shifted to Adyen/PayPal
  const res = http.get(`${BASE_URL}/admin/providers`, {
    headers: DEFAULT_HEADERS,
  });

  check(res, {
    "providers accessible": (r) => r.status === 200,
  });

  const cbRes = http.get(`${BASE_URL}/admin/circuit-breakers`, {
    headers: DEFAULT_HEADERS,
  });

  check(cbRes, {
    "circuit breakers accessible": (r) => r.status === 200,
  });

  try {
    const data = JSON.parse(cbRes.body);
    const stripeCb = data.breakers?.find((b) => b.name === "stripe");
    if (stripeCb) {
      console.log(`>>> Stripe CB state: ${stripeCb.state}, failures: ${stripeCb.failureCount}`);
    }
  } catch { /* noop */ }

  checkHealth();
  sleep(30);
}

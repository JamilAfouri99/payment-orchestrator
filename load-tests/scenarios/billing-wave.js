import http from "k6/http";
import { sleep, check } from "k6";
import { BASE_URL, DEFAULT_HEADERS, THRESHOLDS_RELAXED } from "../config.js";

/**
 * Scenario 4: Subscription Billing Wave
 *
 * Simulates 1000 invoices being generated simultaneously, as would happen
 * during a subscription billing cycle. Each VU creates 10 invoices.
 *
 * Run: k6 run load-tests/scenarios/billing-wave.js
 */

export const options = {
  scenarios: {
    billing_burst: {
      executor: "per-vu-iterations",
      vus: 100,
      iterations: 10,
      maxDuration: "3m",
    },
  },
  thresholds: {
    ...THRESHOLDS_RELAXED,
    "http_req_duration{scenario:billing_burst}": ["p(95)<1000"],
  },
};

export default function () {
  const amount = Math.floor(Math.random() * 20000) + 500;
  const idempotencyKey = `k6_billing_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  // Create a payment simulating an invoice charge
  const payload = JSON.stringify({
    amount,
    currency: "USD",
    customerId: `k6_subscriber_${__VU}`,
    orderId: `k6_invoice_${Date.now()}_${__ITER}`,
    items: [
      {
        productId: "subscription_monthly",
        quantity: 1,
        pricePerUnit: amount,
      },
    ],
  });

  const res = http.post(`${BASE_URL}/payments`, payload, {
    headers: { ...DEFAULT_HEADERS, "Idempotency-Key": idempotencyKey },
  });

  check(res, {
    "invoice payment created": (r) => r.status === 201,
    "has paymentId": (r) => {
      try { return !!JSON.parse(r.body).paymentId; } catch { return false; }
    },
  });

  // Brief pause between batch items
  sleep(0.1);
}

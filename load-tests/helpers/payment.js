import http from "k6/http";
import { check } from "k6";
import { BASE_URL, DEFAULT_HEADERS } from "../config.js";

const CURRENCIES = ["USD", "EUR", "GBP"];
const REGIONS = ["US", "EU", "APAC"];

/**
 * Creates a payment with random parameters.
 * @returns {object} Response data
 */
export function createPayment() {
  const amount = Math.floor(Math.random() * 50000) + 100; // 100–50100 cents
  const currency = CURRENCIES[Math.floor(Math.random() * CURRENCIES.length)];
  const region = REGIONS[Math.floor(Math.random() * REGIONS.length)];
  const idempotencyKey = `k6_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const payload = JSON.stringify({
    amount,
    currency,
    customerId: `k6_customer_${Math.floor(Math.random() * 100)}`,
    orderId: `k6_order_${Date.now()}`,
    items: [{ productId: "k6_product", quantity: 1, pricePerUnit: amount }],
    region,
  });

  const res = http.post(`${BASE_URL}/payments`, payload, {
    headers: { ...DEFAULT_HEADERS, "Idempotency-Key": idempotencyKey },
  });

  check(res, {
    "payment created": (r) => r.status === 201,
    "has paymentId": (r) => {
      try { return !!JSON.parse(r.body).paymentId; } catch { return false; }
    },
  });

  return res;
}

/**
 * Fetches payment list.
 */
export function listPayments(limit = 20) {
  const res = http.get(`${BASE_URL}/payments?limit=${limit}`, {
    headers: DEFAULT_HEADERS,
  });

  check(res, {
    "list ok": (r) => r.status === 200,
  });

  return res;
}

/**
 * Fetches health endpoint.
 */
export function checkHealth() {
  const res = http.get(`${BASE_URL}/health`, { headers: DEFAULT_HEADERS });
  check(res, {
    "health ok": (r) => r.status === 200,
  });
  return res;
}

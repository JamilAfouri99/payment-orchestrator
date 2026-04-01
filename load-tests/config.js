/**
 * Shared configuration for all k6 load test scenarios.
 * Override BASE_URL and API_KEY via environment variables.
 */

export const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
export const API_KEY = __ENV.API_KEY || "";

export const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
  ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
};

export const THRESHOLDS = {
  http_req_duration: ["p(50)<200", "p(95)<500", "p(99)<2000"],
  http_req_failed: ["rate<0.01"],
  checks: ["rate>0.99"],
};

export const THRESHOLDS_RELAXED = {
  http_req_duration: ["p(50)<500", "p(95)<1000", "p(99)<3000"],
  http_req_failed: ["rate<0.05"],
  checks: ["rate>0.95"],
};

import http from "k6/http";
import { check } from "k6";
import { BASE_URL } from "../config.js";

/**
 * Registers a test tenant and returns the API key.
 * Call this in setup() to get a valid key for all VUs.
 */
export function setupAuth() {
  const registerRes = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({
      email: `k6_${Date.now()}@test.local`,
      password: "k6TestPassword123!",
      tenantName: `K6 Load Test ${Date.now()}`,
    }),
    { headers: { "Content-Type": "application/json" } },
  );

  check(registerRes, {
    "register ok": (r) => r.status === 201 || r.status === 200,
  });

  try {
    const body = JSON.parse(registerRes.body);
    return {
      token: body.token || "",
      apiKey: body.apiKey || "",
      tenantId: body.tenantId || "",
    };
  } catch {
    return { token: "", apiKey: "", tenantId: "" };
  }
}

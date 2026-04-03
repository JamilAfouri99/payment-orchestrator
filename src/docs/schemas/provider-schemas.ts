import { jsonBody, jsonResponse, pathParam, problemResponse, queryParam } from "./helpers.js";

function tokenPaths(): Record<string, Record<string, unknown>> {
  return {
    "/tokens": {
      get: {
        tags: ["Tokens"],
        operationId: "listTokens",
        summary: "List payment tokens",
        parameters: [queryParam("customerId", "Filter by customer ID")],
        responses: {
          "200": jsonResponse("Token list", {
            type: "object",
            properties: {
              tokens: { type: "array", items: { $ref: "#/components/schemas/PaymentToken" } },
            },
          }),
        },
      },
    },
    "/tokens/{token}": {
      get: {
        tags: ["Tokens"],
        operationId: "getToken",
        summary: "Get token details",
        parameters: [pathParam("token", "Token value")],
        responses: {
          "200": jsonResponse("Token details", { $ref: "#/components/schemas/PaymentToken" }),
          "404": problemResponse("Token not found"),
        },
      },
    },
    "/tokens/revoke/{token}": {
      post: {
        tags: ["Tokens"],
        operationId: "revokeToken",
        summary: "Revoke a payment token",
        parameters: [pathParam("token", "Token value")],
        responses: {
          "200": jsonResponse("Revoked", {
            type: "object",
            properties: { success: { type: "boolean" } },
          }),
          "404": problemResponse("Token not found"),
        },
      },
    },
  };
}

function providerManagementPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/providers": {
      get: {
        tags: ["Providers"],
        operationId: "listProviders",
        summary: "List all payment providers",
        responses: {
          "200": jsonResponse("Provider list", {
            type: "object",
            properties: {
              providers: { type: "array", items: { $ref: "#/components/schemas/ProviderConfig" } },
            },
          }),
        },
      },
    },
    "/admin/providers/{name}/metrics": {
      get: {
        tags: ["Providers"],
        operationId: "getProviderMetrics",
        summary: "Get metrics for a specific provider",
        parameters: [
          pathParam("name", "Provider name (stripe, adyen, paypal)"),
          queryParam("window", "Time window in ms", "integer", 3600000),
        ],
        responses: { "200": jsonResponse("Provider metrics", { type: "object" }) },
      },
    },
    "/admin/providers/metrics": {
      get: {
        tags: ["Providers"],
        operationId: "getAllProviderMetrics",
        summary: "Get metrics for all providers",
        parameters: [queryParam("window", "Time window in ms", "integer", 3600000)],
        responses: {
          "200": jsonResponse("All provider metrics", {
            type: "object",
            properties: { stats: { type: "array" } },
          }),
        },
      },
    },
    "/admin/routing/simulate": {
      get: {
        tags: ["Providers"],
        operationId: "simulateRouting",
        summary: "Simulate provider routing decision",
        parameters: [
          queryParam("amount", "Amount in cents", "integer", 1000),
          queryParam("currency", "Currency code", "string", "USD"),
          queryParam("region", "Region code", "string", "US"),
          queryParam("customerId", "Customer ID", "string"),
        ],
        responses: { "200": jsonResponse("Routing simulation result", { type: "object" }) },
      },
    },
  };
}

function fxAndDeclinePaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/fx/rates": {
      get: {
        tags: ["FX Rates"],
        operationId: "getFxRates",
        summary: "Get all FX rate pairs",
        responses: {
          "200": jsonResponse("FX rates", {
            type: "object",
            properties: { rates: { type: "array" } },
          }),
        },
      },
      post: {
        tags: ["FX Rates"],
        operationId: "updateFxRate",
        summary: "Update an FX rate pair",
        requestBody: jsonBody({
          type: "object",
          required: ["from", "to", "rate"],
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            rate: { type: "number" },
            spreadBps: { type: "integer", default: 50 },
          },
        }),
        responses: {
          "200": jsonResponse("Updated rates", {
            type: "object",
            properties: { success: { type: "boolean" }, rates: { type: "array" } },
          }),
        },
      },
    },
    "/admin/decline-codes": {
      get: {
        tags: ["Decline Codes"],
        operationId: "listDeclineCodes",
        summary: "List all decline codes with classifications",
        responses: {
          "200": jsonResponse("Decline codes", {
            type: "object",
            properties: { codes: { type: "array" } },
          }),
        },
      },
    },
  };
}

export function buildProviderPaths(): Record<string, Record<string, unknown>> {
  return {
    ...tokenPaths(),
    ...providerManagementPaths(),
    ...fxAndDeclinePaths(),
  };
}

export function buildProviderSchemas(): Record<string, unknown> {
  return {
    ProviderConfig: {
      type: "object",
      properties: {
        name: { type: "string" },
        currencies: { type: "array", items: { type: "string" } },
        regions: { type: "array", items: { type: "string" } },
        costBps: { type: "integer" },
        priority: { type: "integer" },
        circuitBreaker: { type: "string" },
      },
    },
    PaymentToken: {
      type: "object",
      properties: {
        token: { type: "string" },
        customerId: { type: "string" },
        last4: { type: "string" },
        brand: { type: "string" },
        expiryMonth: { type: "integer" },
        expiryYear: { type: "integer" },
        status: { type: "string" },
        createdAt: { type: "string", format: "date-time" },
      },
    },
  };
}

import { jsonBody, jsonResponse, pathParam, problemResponse, queryParam } from "./helpers.js";

function chaosPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/chaos": {
      get: {
        tags: ["Chaos Engineering"],
        operationId: "getChaosConfig",
        summary: "Get chaos configuration",
        responses: {
          "200": jsonResponse("Chaos config", {
            type: "object",
            properties: { services: { type: "object" } },
          }),
        },
      },
      post: {
        tags: ["Chaos Engineering"],
        operationId: "updateChaosConfig",
        summary: "Update chaos configuration for a service",
        requestBody: jsonBody({
          type: "object",
          required: ["service"],
          properties: {
            service: { type: "string" },
            failureRate: { type: "number", minimum: 0, maximum: 1 },
            latencyMs: { type: "integer", minimum: 0 },
            enabled: { type: "boolean" },
          },
        }),
        responses: {
          "200": jsonResponse("Updated config", {
            type: "object",
            properties: { services: { type: "object" } },
          }),
        },
      },
    },
    "/admin/chaos/reset": {
      post: {
        tags: ["Chaos Engineering"],
        operationId: "resetChaos",
        summary: "Reset all chaos to defaults",
        responses: {
          "200": jsonResponse("Reset successful", {
            type: "object",
            properties: { success: { type: "boolean" }, services: { type: "object" } },
          }),
        },
      },
    },
  };
}

function circuitBreakerPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/circuit-breakers": {
      get: {
        tags: ["Circuit Breakers"],
        operationId: "listCircuitBreakers",
        summary: "List all circuit breaker states",
        responses: {
          "200": jsonResponse("Breaker states", {
            type: "object",
            properties: {
              breakers: { type: "array", items: { $ref: "#/components/schemas/CircuitBreakerState" } },
            },
          }),
        },
      },
    },
    "/admin/circuit-breakers/{name}/reset": {
      post: {
        tags: ["Circuit Breakers"],
        operationId: "resetCircuitBreaker",
        summary: "Reset a circuit breaker to closed state",
        parameters: [pathParam("name", "Circuit breaker name")],
        responses: {
          "200": jsonResponse("Reset successful", {
            type: "object",
            properties: { success: { type: "boolean" } },
          }),
          "404": problemResponse("Circuit breaker not found"),
        },
      },
    },
  };
}

function observabilityPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/metrics": {
      get: {
        tags: ["Metrics"],
        operationId: "getMetrics",
        summary: "Get metrics snapshot",
        responses: { "200": jsonResponse("Metrics snapshot", { type: "object" }) },
      },
    },
    "/admin/metrics/reset": {
      post: {
        tags: ["Metrics"],
        operationId: "resetMetrics",
        summary: "Reset all metrics counters",
        responses: {
          "200": jsonResponse("Reset successful", {
            type: "object",
            properties: { success: { type: "boolean" } },
          }),
        },
      },
    },
    "/admin/logs": {
      get: {
        tags: ["Logs"],
        operationId: "getLogs",
        summary: "Get recent structured logs",
        parameters: [queryParam("limit", "Number of log entries", "integer", 100)],
        responses: {
          "200": jsonResponse("Log entries", {
            type: "object",
            properties: { logs: { type: "array", items: { type: "object" } } },
          }),
        },
      },
    },
    "/admin/bulkheads": {
      get: {
        tags: ["Bulkheads"],
        operationId: "getBulkheads",
        summary: "Get bulkhead concurrency stats",
        responses: {
          "200": jsonResponse("Bulkhead stats", {
            type: "object",
            properties: { bulkheads: { type: "array", items: { type: "object" } } },
          }),
        },
      },
    },
    "/admin/saga-recovery": {
      post: {
        tags: ["Saga Recovery"],
        operationId: "triggerSagaRecovery",
        summary: "Trigger recovery of incomplete sagas",
        responses: {
          "200": jsonResponse("Recovery result", {
            type: "object",
            properties: { recovered: { type: "integer" }, errors: { type: "integer" } },
          }),
        },
      },
    },
  };
}

function sandboxPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/sandbox/test-cards": {
      get: {
        tags: ["Sandbox"],
        operationId: "listTestCards",
        summary: "List all test card numbers with behaviors",
        responses: {
          "200": jsonResponse("Test cards", {
            type: "object",
            properties: {
              cards: { type: "array", items: { $ref: "#/components/schemas/TestCard" } },
            },
          }),
        },
      },
    },
    "/admin/sandbox/trigger-dispute": {
      post: {
        tags: ["Sandbox"],
        operationId: "triggerSandboxDispute",
        summary: "Trigger a dispute on a sandbox payment",
        requestBody: jsonBody({
          type: "object",
          required: ["paymentId"],
          properties: { paymentId: { type: "string" } },
        }),
        responses: {
          "200": jsonResponse("Dispute triggered", {
            type: "object",
            properties: { disputeId: { type: "string" }, paymentId: { type: "string" } },
          }),
          "404": problemResponse("Payment not found"),
        },
      },
    },
    "/admin/sandbox/reset": {
      post: {
        tags: ["Sandbox"],
        operationId: "resetSandbox",
        summary: "Reset all sandbox data for tenant",
        responses: {
          "200": jsonResponse("Reset complete", {
            type: "object",
            properties: { deleted: { type: "integer" } },
          }),
        },
      },
    },
  };
}

function experimentPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/experiments": {
      get: {
        tags: ["Experiments"],
        operationId: "listExperiments",
        summary: "List routing experiments",
        responses: { "200": jsonResponse("Experiments", { type: "object" }) },
      },
      post: {
        tags: ["Experiments"],
        operationId: "createExperiment",
        summary: "Create a routing experiment",
        requestBody: jsonBody({ type: "object" }),
        responses: { "201": jsonResponse("Experiment created", { type: "object" }) },
      },
    },
    "/admin/experiments/{id}": {
      get: {
        tags: ["Experiments"],
        operationId: "getExperiment",
        summary: "Get experiment details",
        parameters: [pathParam("id", "Experiment ID")],
        responses: { "200": jsonResponse("Experiment", { type: "object" }) },
      },
    },
    "/admin/experiments/{id}/stop": {
      post: {
        tags: ["Experiments"],
        operationId: "stopExperiment",
        summary: "Stop an active experiment",
        parameters: [pathParam("id", "Experiment ID")],
        responses: { "200": jsonResponse("Stopped", { type: "object" }) },
      },
    },
    "/admin/experiments/{id}/results": {
      get: {
        tags: ["Experiments"],
        operationId: "getExperimentResults",
        summary: "Get experiment results and analysis",
        parameters: [pathParam("id", "Experiment ID")],
        responses: { "200": jsonResponse("Results", { type: "object" }) },
      },
    },
    "/admin/reports": {
      post: {
        tags: ["Reports"],
        operationId: "generateReport",
        summary: "Generate an analytics report",
        requestBody: jsonBody({ type: "object" }),
        responses: { "201": jsonResponse("Report generated", { type: "object" }) },
      },
    },
    "/admin/reports/{id}": {
      get: {
        tags: ["Reports"],
        operationId: "getReport",
        summary: "Get report details",
        parameters: [pathParam("id", "Report ID")],
        responses: { "200": jsonResponse("Report", { type: "object" }) },
      },
    },
    "/admin/analytics/revenue": {
      get: {
        tags: ["Analytics"],
        operationId: "getRevenueAnalytics",
        summary: "Get revenue analytics",
        parameters: [
          queryParam("from", "Start date"),
          queryParam("to", "End date"),
          queryParam("granularity", "Time granularity"),
        ],
        responses: { "200": jsonResponse("Revenue data", { type: "object" }) },
      },
    },
  };
}

export function buildAdminPaths(): Record<string, Record<string, unknown>> {
  return {
    ...chaosPaths(),
    ...circuitBreakerPaths(),
    ...observabilityPaths(),
    ...sandboxPaths(),
    ...experimentPaths(),
  };
}

export function buildAdminSchemas(): Record<string, unknown> {
  return {
    TestCard: {
      type: "object",
      properties: {
        number: { type: "string" },
        behavior: { type: "string" },
        description: { type: "string" },
        declineCode: { type: "string" },
      },
    },
  };
}

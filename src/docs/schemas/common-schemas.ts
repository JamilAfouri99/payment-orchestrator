export function buildCommonSchemas(): Record<string, unknown> {
  return {
    ProblemDetails: {
      type: "object",
      description: "RFC 7807 Problem Details for HTTP APIs",
      required: ["type", "title", "status", "detail"],
      properties: {
        type: { type: "string", format: "uri", description: "Problem type URI" },
        title: { type: "string", description: "Human-readable title" },
        status: { type: "integer", description: "HTTP status code" },
        detail: { type: "string", description: "Detailed explanation" },
        instance: { type: "string", description: "Specific occurrence URI" },
      },
      example: {
        type: "https://payment-orchestrator.dev/problems/not-found",
        title: "Not Found",
        status: 404,
        detail: "Payment pay_abc123 not found",
      },
    },
    CircuitBreakerState: {
      type: "object",
      properties: {
        name: { type: "string" },
        state: { type: "string", enum: ["closed", "open", "half_open"] },
        failures: { type: "integer" },
        successes: { type: "integer" },
        lastFailure: { type: "string", format: "date-time" },
      },
    },
    RegisterResponse: {
      type: "object",
      properties: {
        token: { type: "string" },
        user: { $ref: "#/components/schemas/User" },
        tenant: { $ref: "#/components/schemas/Tenant" },
        apiKey: {
          type: "object",
          properties: {
            prefix: { type: "string" },
            environment: { type: "string" },
          },
        },
      },
    },
    User: {
      type: "object",
      properties: {
        id: { type: "string" },
        email: { type: "string" },
        name: { type: "string" },
        role: { type: "string" },
      },
    },
    Tenant: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        slug: { type: "string" },
        status: { type: "string" },
        plan: { type: "string" },
        country: { type: "string" },
      },
    },
  };
}

export function buildCommonHeaders(): Record<string, unknown> {
  return {
    "X-Request-ID": {
      description: "Correlation ID for request tracing",
      schema: { type: "string", format: "uuid" },
    },
    "X-RateLimit-Limit": {
      description: "Maximum requests per window",
      schema: { type: "integer" },
    },
    "X-RateLimit-Remaining": {
      description: "Remaining requests in current window",
      schema: { type: "integer" },
    },
    "X-RateLimit-Reset": {
      description: "Seconds until rate limit resets",
      schema: { type: "integer" },
    },
  };
}

export function buildSecuritySchemes(): Record<string, unknown> {
  return {
    BearerAuth: {
      type: "http",
      scheme: "bearer",
      description: "API key passed as Bearer token. Generate keys via POST /api-keys.",
    },
  };
}

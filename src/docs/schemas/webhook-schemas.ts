import { jsonBody, jsonResponse, pathParam, problemResponse, queryParam } from "./helpers.js";

function webhookRegistrationPaths(): Record<string, Record<string, unknown>> {
  return {
    "/webhooks/register": {
      post: {
        tags: ["Webhooks"],
        operationId: "registerWebhook",
        summary: "Register a webhook URL",
        requestBody: jsonBody(
          {
            type: "object",
            required: ["url"],
            properties: {
              url: { type: "string", format: "uri" },
              events: {
                type: "array",
                items: { type: "string" },
                description: "Event types to subscribe to (default: all)",
              },
            },
          },
          { url: "https://example.com/webhooks", events: ["payment.created", "payment.captured"] },
        ),
        responses: {
          "201": jsonResponse("Webhook registered", {
            type: "object",
            properties: {
              id: { type: "string" },
              url: { type: "string" },
              events: { type: "array", items: { type: "string" } },
            },
          }),
        },
      },
    },
    "/webhooks/registrations": {
      get: {
        tags: ["Webhooks"],
        operationId: "listWebhookRegistrations",
        summary: "List webhook registrations",
        responses: {
          "200": jsonResponse("Registrations", {
            type: "array",
            items: { $ref: "#/components/schemas/WebhookRegistration" },
          }),
        },
      },
    },
  };
}

function webhookDeliveryPaths(): Record<string, Record<string, unknown>> {
  return {
    "/webhooks/deliveries": {
      get: {
        tags: ["Webhooks"],
        operationId: "listWebhookDeliveries",
        summary: "List recent webhook deliveries",
        responses: {
          "200": jsonResponse("Deliveries (last 100)", {
            type: "array",
            items: { $ref: "#/components/schemas/WebhookDelivery" },
          }),
        },
      },
    },
    "/webhooks/dlq": {
      get: {
        tags: ["Webhooks"],
        operationId: "listDeadLetterQueue",
        summary: "List dead-letter queue entries",
        responses: {
          "200": jsonResponse("DLQ entries (last 100)", {
            type: "array",
            items: { $ref: "#/components/schemas/DeadLetterEntry" },
          }),
        },
      },
    },
    "/webhooks/dlq/{id}/retry": {
      post: {
        tags: ["Webhooks"],
        operationId: "retryDeadLetter",
        summary: "Retry a dead-letter entry",
        parameters: [pathParam("id", "DLQ entry ID")],
        responses: {
          "200": jsonResponse("Retry initiated", {
            type: "object",
            properties: { success: { type: "boolean" } },
          }),
          "404": problemResponse("DLQ entry not found"),
        },
      },
    },
    "/webhooks/verify": {
      post: {
        tags: ["Webhooks"],
        operationId: "verifyWebhookSignature",
        summary: "Verify a webhook HMAC-SHA256 signature",
        requestBody: jsonBody({
          type: "object",
          required: ["payload", "signature"],
          properties: {
            payload: { type: "string", description: "Raw JSON payload string" },
            signature: { type: "string", description: "Hex-encoded HMAC-SHA256 signature" },
            secret: {
              type: "string",
              description: "Optional custom secret (defaults to tenant webhook secret)",
            },
          },
        }),
        responses: {
          "200": jsonResponse("Verification result", {
            type: "object",
            properties: {
              valid: { type: "boolean" },
              computedSignature: { type: "string" },
              providedSignature: { type: "string" },
            },
          }),
        },
      },
    },
  };
}

function webhookCorePaths(): Record<string, Record<string, unknown>> {
  return { ...webhookRegistrationPaths(), ...webhookDeliveryPaths() };
}

function webhookCatalogPaths(): Record<string, Record<string, unknown>> {
  return {
    "/admin/webhook-catalog": {
      get: {
        tags: ["Webhook Catalog"],
        operationId: "listWebhookEvents",
        summary: "List all webhook event type definitions",
        parameters: [
          queryParam("category", "Filter by category (payment, subscription, dispute, payout, merchant)"),
        ],
        responses: {
          "200": jsonResponse("Event catalog", {
            type: "object",
            properties: {
              events: { type: "array", items: { $ref: "#/components/schemas/WebhookEventDefinition" } },
              categories: { type: "array", items: { type: "string" } },
            },
          }),
        },
      },
    },
    "/admin/webhook-catalog/{type}": {
      get: {
        tags: ["Webhook Catalog"],
        operationId: "getWebhookEvent",
        summary: "Get a specific webhook event definition",
        parameters: [pathParam("type", "Event type (e.g., payment.created)")],
        responses: {
          "200": jsonResponse("Event definition", { $ref: "#/components/schemas/WebhookEventDefinition" }),
          "404": problemResponse("Event type not found"),
        },
      },
    },
  };
}

export function buildWebhookPaths(): Record<string, Record<string, unknown>> {
  return {
    ...webhookCorePaths(),
    ...webhookCatalogPaths(),
  };
}

export function buildWebhookSchemas(): Record<string, unknown> {
  return {
    WebhookRegistration: {
      type: "object",
      properties: {
        id: { type: "string" },
        url: { type: "string", format: "uri" },
        events: { type: "array", items: { type: "string" } },
        active: { type: "boolean" },
        createdAt: { type: "string", format: "date-time" },
      },
    },
    WebhookDelivery: {
      type: "object",
      properties: {
        id: { type: "string" },
        eventType: { type: "string" },
        url: { type: "string" },
        status: { type: "string", enum: ["pending", "delivered", "dead_lettered"] },
        attempts: { type: "integer" },
        lastError: { type: "string" },
        createdAt: { type: "string", format: "date-time" },
      },
    },
    DeadLetterEntry: {
      type: "object",
      properties: {
        id: { type: "string" },
        sourceType: { type: "string" },
        sourceId: { type: "string" },
        payload: { type: "object" },
        error: { type: "string" },
        attempts: { type: "integer" },
        createdAt: { type: "string", format: "date-time" },
      },
    },
    WebhookEventDefinition: {
      type: "object",
      properties: {
        type: { type: "string" },
        category: { type: "string" },
        description: { type: "string" },
        payloadFields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string" },
              description: { type: "string" },
              required: { type: "boolean" },
            },
          },
        },
        example: { type: "object" },
      },
    },
    WebhookEventEnvelope: {
      type: "object",
      description: "Standard webhook delivery envelope",
      properties: {
        id: { type: "string", description: "Unique event ID (use as idempotency key)" },
        type: { type: "string", description: "Event type (e.g., payment.created)" },
        apiVersion: { type: "string", description: "API version" },
        createdAt: { type: "string", format: "date-time" },
        data: {
          type: "object",
          properties: {
            object: { type: "object", description: "Full resource object" },
          },
        },
      },
      example: {
        id: "evt_abc123",
        type: "payment.captured",
        apiVersion: "2024-01-01",
        createdAt: "2024-01-15T10:30:05Z",
        data: {
          object: {
            id: "pay_abc123",
            status: "completed",
            amount: 5000,
            currency: "USD",
          },
        },
      },
    },
  };
}

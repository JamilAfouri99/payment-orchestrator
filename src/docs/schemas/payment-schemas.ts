import { jsonBody, jsonResponse, pathParam, problemResponse, queryParam } from "./helpers.js";

function corePaymentPaths(): Record<string, Record<string, unknown>> {
  return {
    "/health": {
      get: {
        tags: ["Health"],
        operationId: "getHealth",
        summary: "Health check",
        description: "Verifies API and database connectivity.",
        security: [],
        responses: {
          "200": jsonResponse(
            "Healthy",
            {
              type: "object",
              properties: {
                status: { type: "string", enum: ["healthy"] },
                timestamp: { type: "string", format: "date-time" },
              },
            },
            { status: "healthy", timestamp: "2024-01-15T10:30:00Z" },
          ),
          "503": problemResponse("Database connectivity check failed"),
        },
      },
    },
    "/payments": {
      get: {
        tags: ["Payments"],
        operationId: "listPayments",
        summary: "List payments",
        parameters: [
          queryParam("limit", "Max results (1-100)", "integer", 20),
          queryParam("offset", "Offset for pagination", "integer", 0),
        ],
        responses: {
          "200": jsonResponse("Payment list", {
            type: "object",
            properties: {
              payments: { type: "array", items: { $ref: "#/components/schemas/PaymentState" } },
              total: { type: "integer" },
            },
          }),
        },
      },
      post: {
        tags: ["Payments"],
        operationId: "createPayment",
        summary: "Create a new payment",
        description: "Initiates a payment saga: validate → reserve inventory → charge provider → notify.",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string" },
            description: "Unique key for idempotent processing",
          },
        ],
        requestBody: jsonBody({ $ref: "#/components/schemas/PaymentRequest" }, {
          amount: 5000,
          currency: "USD",
          customerId: "cus_xyz",
          orderId: "ord_456",
          items: [{ productId: "prod_1", quantity: 2, pricePerUnit: 2500 }],
          region: "US",
        }),
        responses: {
          "201": jsonResponse("Payment initiated", { $ref: "#/components/schemas/PaymentState" }),
          "400": problemResponse("Invalid payment request"),
          "403": problemResponse("Fraud blocked"),
        },
      },
    },
    "/payments/{id}": {
      get: {
        tags: ["Payments"],
        operationId: "getPayment",
        summary: "Get payment by ID",
        parameters: [pathParam("id", "Payment ID")],
        responses: {
          "200": jsonResponse("Payment details", { $ref: "#/components/schemas/PaymentState" }),
          "404": problemResponse("Payment not found"),
        },
      },
    },
  };
}

function paymentEventPaths(): Record<string, Record<string, unknown>> {
  return {
    "/payments/{id}/events": {
      get: {
        tags: ["Payments"],
        operationId: "getPaymentEvents",
        summary: "Get payment event history",
        description: "Returns the full event sourcing history for a payment.",
        parameters: [pathParam("id", "Payment ID")],
        responses: {
          "200": jsonResponse("Event list", {
            type: "array",
            items: { $ref: "#/components/schemas/DomainEvent" },
          }),
        },
      },
    },
    "/payments/{id}/state": {
      get: {
        tags: ["Payments"],
        operationId: "getPaymentStateAt",
        summary: "Get payment state at a point in time",
        description: "Temporal query — replays events up to the given timestamp.",
        parameters: [
          pathParam("id", "Payment ID"),
          {
            name: "at",
            in: "query",
            required: true,
            schema: { type: "string", format: "date-time" },
            description: "ISO 8601 timestamp",
          },
        ],
        responses: {
          "200": jsonResponse("Payment state at time", { $ref: "#/components/schemas/PaymentState" }),
          "400": problemResponse("Invalid date format"),
        },
      },
    },
    "/payments/{id}/replay": {
      post: {
        tags: ["Payments"],
        operationId: "replayPayment",
        summary: "Replay payment from events",
        description: "Rebuilds payment state by replaying all events, bypassing snapshot.",
        parameters: [pathParam("id", "Payment ID")],
        responses: {
          "200": jsonResponse("Replayed state", { $ref: "#/components/schemas/PaymentState" }),
        },
      },
    },
    "/payments/{id}/retries": {
      get: {
        tags: ["Payments"],
        operationId: "getPaymentRetries",
        summary: "Get retry history for a payment",
        parameters: [pathParam("id", "Payment ID")],
        responses: {
          "200": jsonResponse("Retry history", {
            type: "object",
            properties: { retries: { type: "array" } },
          }),
        },
      },
    },
  };
}

export function buildPaymentPaths(): Record<string, Record<string, unknown>> {
  return {
    ...corePaymentPaths(),
    ...paymentEventPaths(),
  };
}

export function buildPaymentSchemas(): Record<string, unknown> {
  return {
    PaymentRequest: {
      type: "object",
      required: ["amount", "currency", "customerId", "orderId", "items"],
      properties: {
        amount: { type: "integer", description: "Amount in cents" },
        currency: { type: "string", description: "ISO 4217 currency code" },
        customerId: { type: "string" },
        orderId: { type: "string" },
        items: { type: "array", items: { $ref: "#/components/schemas/OrderItem" } },
        region: { type: "string", description: "Customer region (US, EU, APAC, ME)" },
        card: { $ref: "#/components/schemas/CardDetails" },
        token: { type: "string", description: "Payment token (tok_...) instead of card" },
      },
    },
    OrderItem: {
      type: "object",
      required: ["productId", "quantity", "pricePerUnit"],
      properties: {
        productId: { type: "string" },
        quantity: { type: "integer" },
        pricePerUnit: { type: "integer", description: "Price per unit in cents" },
      },
    },
    CardDetails: {
      type: "object",
      properties: {
        pan: { type: "string", description: "Card number (will be tokenized)" },
        expiryMonth: { type: "integer" },
        expiryYear: { type: "integer" },
        brand: { type: "string" },
      },
    },
    PaymentState: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: {
          type: "string",
          enum: [
            "pending", "validating", "reserving_inventory", "charging",
            "notifying", "completed", "failed", "compensating", "compensated",
          ],
        },
        amount: { type: "integer" },
        currency: { type: "string" },
        customerId: { type: "string" },
        orderId: { type: "string" },
        items: { type: "array", items: { $ref: "#/components/schemas/OrderItem" } },
        region: { type: "string" },
        providerId: { type: "string" },
        tokenId: { type: "string" },
        fraudScore: { type: "number" },
        fraudAction: { type: "string" },
        declineCode: { type: "string" },
        error: { type: "string" },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
    DomainEvent: {
      type: "object",
      properties: {
        id: { type: "string" },
        aggregateId: { type: "string" },
        aggregateType: { type: "string" },
        eventType: { type: "string" },
        version: { type: "integer" },
        payload: { type: "object" },
        metadata: { type: "object" },
        createdAt: { type: "string", format: "date-time" },
      },
    },
  };
}

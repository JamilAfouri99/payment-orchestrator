/**
 * OpenAPI 3.1 specification for the Payment Orchestrator API.
 *
 * Hand-crafted as a TypeScript object so it stays co-located with the code
 * and benefits from type checking. Served at /openapi.json.
 */

export interface OpenAPISpec {
  openapi: string;
  info: Record<string, unknown>;
  servers: Record<string, unknown>[];
  security: Record<string, unknown[]>[];
  tags: { name: string; description: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, unknown>;
}

function problemResponse(detail: string): Record<string, unknown> {
  return {
    description: detail,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ProblemDetails" },
      },
    },
  };
}

function jsonBody(schema: Record<string, unknown>, example?: Record<string, unknown>): Record<string, unknown> {
  return {
    required: true,
    content: {
      "application/json": {
        schema,
        ...(example !== undefined ? { example } : {}),
      },
    },
  };
}

function jsonResponse(description: string, schema: Record<string, unknown>, example?: unknown): Record<string, unknown> {
  return {
    description,
    content: {
      "application/json": {
        schema,
        ...(example !== undefined ? { example } : {}),
      },
    },
  };
}

function pathParam(name: string, description: string): Record<string, unknown> {
  return { name, in: "path", required: true, schema: { type: "string" }, description };
}

function queryParam(name: string, description: string, type: string = "string", defaultValue?: unknown): Record<string, unknown> {
  return {
    name,
    in: "query",
    required: false,
    schema: { type, ...(defaultValue !== undefined ? { default: defaultValue } : {}) },
    description,
  };
}

export function buildOpenAPISpec(): OpenAPISpec {
  return {
    openapi: "3.1.0",
    info: {
      title: "Payment Orchestrator API",
      version: "1.0.0",
      description:
        "Production-grade payment processing API with multi-provider routing, saga orchestration, " +
        "event sourcing, fraud detection, tokenization, subscriptions, and more.",
      contact: { name: "API Support", url: "https://payment-orchestrator.dev" },
      license: { name: "MIT" },
    },
    servers: [
      { url: "http://localhost:3000", description: "Local development" },
    ],
    security: [{ BearerAuth: [] }],
    tags: [
      { name: "Health", description: "Health check endpoints" },
      { name: "Authentication", description: "User registration, login, and session management" },
      { name: "Onboarding", description: "KYB verification and merchant onboarding" },
      { name: "API Keys", description: "API key management" },
      { name: "Team", description: "Team member management and invitations" },
      { name: "Payments", description: "Payment creation, retrieval, and event sourcing" },
      { name: "Webhooks", description: "Webhook registration, delivery, and verification" },
      { name: "Chaos Engineering", description: "Fault injection for testing resilience" },
      { name: "Circuit Breakers", description: "Circuit breaker state management" },
      { name: "Metrics", description: "System metrics and counters" },
      { name: "Logs", description: "Structured log retrieval" },
      { name: "Bulkheads", description: "Concurrency isolation stats" },
      { name: "Saga Recovery", description: "Incomplete saga recovery" },
      { name: "Providers", description: "Payment provider management and routing simulation" },
      { name: "Fraud", description: "Fraud rule management and scoring simulation" },
      { name: "Tokens", description: "PCI-compliant card tokenization" },
      { name: "FX Rates", description: "Foreign exchange rate management" },
      { name: "Decline Codes", description: "Decline code reference" },
      { name: "Ledger", description: "Double-entry ledger accounts and transactions" },
      { name: "Settlements", description: "Merchant settlement management" },
      { name: "Subscriptions", description: "Subscription and plan management" },
      { name: "Invoices", description: "Invoice management" },
      { name: "Billing", description: "Subscription billing processing" },
      { name: "Dunning", description: "Failed payment recovery (dunning) management" },
      { name: "Disputes", description: "Chargeback and dispute management" },
      { name: "Split Payments", description: "Payment splitting across multiple recipients" },
      { name: "Payouts", description: "Merchant payout management" },
      { name: "3D Secure", description: "3D Secure authentication simulation" },
      { name: "Payment Methods", description: "Alternative payment method management" },
      { name: "Checkout", description: "Hosted checkout session management" },
      { name: "Sandbox", description: "Sandbox testing tools and test card reference" },
      { name: "Webhook Catalog", description: "Webhook event type documentation" },
    ],
    paths: {
      // --- Health ---
      "/health": {
        get: {
          tags: ["Health"],
          operationId: "getHealth",
          summary: "Health check",
          description: "Verifies API and database connectivity.",
          security: [],
          responses: {
            "200": jsonResponse("Healthy", {
              type: "object",
              properties: {
                status: { type: "string", enum: ["healthy"] },
                timestamp: { type: "string", format: "date-time" },
              },
            }, { status: "healthy", timestamp: "2024-01-15T10:30:00Z" }),
            "503": problemResponse("Database connectivity check failed"),
          },
        },
      },

      // --- Authentication ---
      "/auth/register": {
        post: {
          tags: ["Authentication"],
          operationId: "register",
          summary: "Register a new merchant account",
          security: [],
          requestBody: jsonBody({
            type: "object",
            required: ["email", "password", "name", "companyName", "slug", "country"],
            properties: {
              email: { type: "string", format: "email" },
              password: { type: "string", minLength: 8 },
              name: { type: "string" },
              companyName: { type: "string" },
              slug: { type: "string" },
              country: { type: "string" },
            },
          }, { email: "merchant@example.com", password: "securePass123", name: "Jane Doe", companyName: "Acme Corp", slug: "acme", country: "US" }),
          responses: {
            "201": jsonResponse("Registration successful", { $ref: "#/components/schemas/RegisterResponse" }),
            "400": problemResponse("Missing required fields"),
            "409": problemResponse("Email already taken"),
          },
        },
      },
      "/auth/login": {
        post: {
          tags: ["Authentication"],
          operationId: "login",
          summary: "Login with email and password",
          security: [],
          requestBody: jsonBody({
            type: "object",
            required: ["email", "password"],
            properties: {
              email: { type: "string", format: "email" },
              password: { type: "string" },
            },
          }),
          responses: {
            "200": jsonResponse("Login successful", {
              type: "object",
              properties: {
                token: { type: "string" },
                user: { $ref: "#/components/schemas/User" },
              },
            }),
            "401": problemResponse("Invalid credentials"),
          },
        },
      },
      "/auth/me": {
        get: {
          tags: ["Authentication"],
          operationId: "getMe",
          summary: "Get current user and tenant",
          responses: {
            "200": jsonResponse("Current user", {
              type: "object",
              properties: {
                user: { $ref: "#/components/schemas/User" },
                tenant: { $ref: "#/components/schemas/Tenant" },
              },
            }),
            "401": problemResponse("Authentication required"),
          },
        },
      },

      // --- Payments ---
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
            { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" }, description: "Unique key for idempotent processing" },
          ],
          requestBody: jsonBody({ $ref: "#/components/schemas/PaymentRequest" }, {
            amount: 5000, currency: "USD", customerId: "cus_xyz", orderId: "ord_456",
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
            { name: "at", in: "query", required: true, schema: { type: "string", format: "date-time" }, description: "ISO 8601 timestamp" },
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

      // --- Webhooks ---
      "/webhooks/register": {
        post: {
          tags: ["Webhooks"],
          operationId: "registerWebhook",
          summary: "Register a webhook URL",
          requestBody: jsonBody({
            type: "object",
            required: ["url"],
            properties: {
              url: { type: "string", format: "uri" },
              events: { type: "array", items: { type: "string" }, description: "Event types to subscribe to (default: all)" },
            },
          }, { url: "https://example.com/webhooks", events: ["payment.created", "payment.captured"] }),
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
            "200": jsonResponse("Retry initiated", { type: "object", properties: { success: { type: "boolean" } } }),
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
              secret: { type: "string", description: "Optional custom secret (defaults to tenant webhook secret)" },
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

      // --- Chaos Engineering ---
      "/admin/chaos": {
        get: {
          tags: ["Chaos Engineering"],
          operationId: "getChaosConfig",
          summary: "Get chaos configuration",
          responses: { "200": jsonResponse("Chaos config", { type: "object", properties: { services: { type: "object" } } }) },
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
          responses: { "200": jsonResponse("Updated config", { type: "object", properties: { services: { type: "object" } } }) },
        },
      },
      "/admin/chaos/reset": {
        post: {
          tags: ["Chaos Engineering"],
          operationId: "resetChaos",
          summary: "Reset all chaos to defaults",
          responses: { "200": jsonResponse("Reset successful", { type: "object", properties: { success: { type: "boolean" }, services: { type: "object" } } }) },
        },
      },

      // --- Circuit Breakers ---
      "/admin/circuit-breakers": {
        get: {
          tags: ["Circuit Breakers"],
          operationId: "listCircuitBreakers",
          summary: "List all circuit breaker states",
          responses: { "200": jsonResponse("Breaker states", { type: "object", properties: { breakers: { type: "array", items: { $ref: "#/components/schemas/CircuitBreakerState" } } } }) },
        },
      },
      "/admin/circuit-breakers/{name}/reset": {
        post: {
          tags: ["Circuit Breakers"],
          operationId: "resetCircuitBreaker",
          summary: "Reset a circuit breaker to closed state",
          parameters: [pathParam("name", "Circuit breaker name")],
          responses: {
            "200": jsonResponse("Reset successful", { type: "object", properties: { success: { type: "boolean" } } }),
            "404": problemResponse("Circuit breaker not found"),
          },
        },
      },

      // --- Metrics ---
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
          responses: { "200": jsonResponse("Reset successful", { type: "object", properties: { success: { type: "boolean" } } }) },
        },
      },

      // --- Logs ---
      "/admin/logs": {
        get: {
          tags: ["Logs"],
          operationId: "getLogs",
          summary: "Get recent structured logs",
          parameters: [queryParam("limit", "Number of log entries", "integer", 100)],
          responses: { "200": jsonResponse("Log entries", { type: "object", properties: { logs: { type: "array", items: { type: "object" } } } }) },
        },
      },

      // --- Bulkheads ---
      "/admin/bulkheads": {
        get: {
          tags: ["Bulkheads"],
          operationId: "getBulkheads",
          summary: "Get bulkhead concurrency stats",
          responses: { "200": jsonResponse("Bulkhead stats", { type: "object", properties: { bulkheads: { type: "array", items: { type: "object" } } } }) },
        },
      },

      // --- Saga Recovery ---
      "/admin/saga-recovery": {
        post: {
          tags: ["Saga Recovery"],
          operationId: "triggerSagaRecovery",
          summary: "Trigger recovery of incomplete sagas",
          responses: { "200": jsonResponse("Recovery result", { type: "object", properties: { recovered: { type: "integer" }, errors: { type: "integer" } } }) },
        },
      },

      // --- Providers ---
      "/admin/providers": {
        get: {
          tags: ["Providers"],
          operationId: "listProviders",
          summary: "List all payment providers",
          responses: { "200": jsonResponse("Provider list", { type: "object", properties: { providers: { type: "array", items: { $ref: "#/components/schemas/ProviderConfig" } } } }) },
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
          responses: { "200": jsonResponse("All provider metrics", { type: "object", properties: { stats: { type: "array" } } }) },
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

      // --- Fraud ---
      "/admin/fraud/rules": {
        get: {
          tags: ["Fraud"],
          operationId: "listFraudRules",
          summary: "List all fraud rules",
          responses: { "200": jsonResponse("Fraud rules", { type: "object", properties: { rules: { type: "array", items: { $ref: "#/components/schemas/FraudRule" } } } }) },
        },
        post: {
          tags: ["Fraud"],
          operationId: "createFraudRule",
          summary: "Create a new fraud rule",
          requestBody: jsonBody({ $ref: "#/components/schemas/FraudRuleInput" }),
          responses: { "201": jsonResponse("Created rule", { $ref: "#/components/schemas/FraudRule" }) },
        },
      },
      "/admin/fraud/rules/{id}": {
        put: {
          tags: ["Fraud"],
          operationId: "updateFraudRule",
          summary: "Update a fraud rule",
          parameters: [pathParam("id", "Rule ID")],
          requestBody: jsonBody({ $ref: "#/components/schemas/FraudRuleInput" }),
          responses: { "200": jsonResponse("Updated rule", { $ref: "#/components/schemas/FraudRule" }) },
        },
        delete: {
          tags: ["Fraud"],
          operationId: "deleteFraudRule",
          summary: "Delete a fraud rule",
          parameters: [pathParam("id", "Rule ID")],
          responses: {
            "200": jsonResponse("Deleted", { type: "object", properties: { success: { type: "boolean" } } }),
            "404": problemResponse("Rule not found"),
          },
        },
      },
      "/payments/{id}/fraud": {
        get: {
          tags: ["Fraud"],
          operationId: "getPaymentFraud",
          summary: "Get fraud evaluation for a payment",
          parameters: [pathParam("id", "Payment ID")],
          responses: { "200": jsonResponse("Fraud evaluation", { $ref: "#/components/schemas/FraudEvaluation" }), "404": problemResponse("No evaluation found") },
        },
      },
      "/admin/fraud/simulate": {
        post: {
          tags: ["Fraud"],
          operationId: "simulateFraud",
          summary: "Simulate fraud scoring",
          requestBody: jsonBody({
            type: "object",
            properties: {
              amount: { type: "integer" },
              currency: { type: "string" },
              customerId: { type: "string" },
              region: { type: "string" },
              customerPaymentCount: { type: "integer" },
              customerAvgAmount: { type: "integer" },
            },
          }),
          responses: { "200": jsonResponse("Simulation result", { $ref: "#/components/schemas/FraudEvaluation" }) },
        },
      },

      // --- Tokens ---
      "/tokens": {
        get: {
          tags: ["Tokens"],
          operationId: "listTokens",
          summary: "List payment tokens",
          parameters: [queryParam("customerId", "Filter by customer ID")],
          responses: { "200": jsonResponse("Token list", { type: "object", properties: { tokens: { type: "array", items: { $ref: "#/components/schemas/PaymentToken" } } } }) },
        },
      },
      "/tokens/{token}": {
        get: {
          tags: ["Tokens"],
          operationId: "getToken",
          summary: "Get token details",
          parameters: [pathParam("token", "Token value")],
          responses: { "200": jsonResponse("Token details", { $ref: "#/components/schemas/PaymentToken" }), "404": problemResponse("Token not found") },
        },
      },
      "/tokens/revoke/{token}": {
        post: {
          tags: ["Tokens"],
          operationId: "revokeToken",
          summary: "Revoke a payment token",
          parameters: [pathParam("token", "Token value")],
          responses: { "200": jsonResponse("Revoked", { type: "object", properties: { success: { type: "boolean" } } }), "404": problemResponse("Token not found") },
        },
      },

      // --- FX Rates ---
      "/admin/fx/rates": {
        get: {
          tags: ["FX Rates"],
          operationId: "getFxRates",
          summary: "Get all FX rate pairs",
          responses: { "200": jsonResponse("FX rates", { type: "object", properties: { rates: { type: "array" } } }) },
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
          responses: { "200": jsonResponse("Updated rates", { type: "object", properties: { success: { type: "boolean" }, rates: { type: "array" } } }) },
        },
      },

      // --- Decline Codes ---
      "/admin/decline-codes": {
        get: {
          tags: ["Decline Codes"],
          operationId: "listDeclineCodes",
          summary: "List all decline codes with classifications",
          responses: { "200": jsonResponse("Decline codes", { type: "object", properties: { codes: { type: "array" } } }) },
        },
      },

      // --- Retry History ---
      "/payments/{id}/retries": {
        get: {
          tags: ["Payments"],
          operationId: "getPaymentRetries",
          summary: "Get retry history for a payment",
          parameters: [pathParam("id", "Payment ID")],
          responses: { "200": jsonResponse("Retry history", { type: "object", properties: { retries: { type: "array" } } }) },
        },
      },

      // --- Ledger ---
      "/admin/ledger/accounts": {
        get: {
          tags: ["Ledger"],
          operationId: "listLedgerAccounts",
          summary: "List all ledger accounts with balances",
          responses: { "200": jsonResponse("Ledger accounts", { type: "object", properties: { accounts: { type: "array", items: { $ref: "#/components/schemas/LedgerAccount" } } } }) },
        },
      },
      "/admin/ledger/accounts/{id}/balance": {
        get: {
          tags: ["Ledger"],
          operationId: "getLedgerBalance",
          summary: "Get balance for a ledger account",
          parameters: [pathParam("id", "Account ID"), queryParam("asOf", "Balance as of date (ISO 8601)")],
          responses: { "200": jsonResponse("Account balance", { type: "object", properties: { balance: { type: "integer" }, currency: { type: "string" } } }), "404": problemResponse("Account not found") },
        },
      },
      "/admin/ledger/accounts/{id}/statement": {
        get: {
          tags: ["Ledger"],
          operationId: "getLedgerStatement",
          summary: "Get account statement",
          parameters: [pathParam("id", "Account ID"), queryParam("from", "Start date"), queryParam("to", "End date")],
          responses: { "200": jsonResponse("Account statement", { type: "object", properties: { entries: { type: "array" } } }) },
        },
      },
      "/admin/ledger/transactions": {
        get: {
          tags: ["Ledger"],
          operationId: "listLedgerTransactions",
          summary: "List ledger transactions",
          parameters: [queryParam("limit", "Max results", "integer", 50), queryParam("offset", "Offset", "integer", 0)],
          responses: { "200": jsonResponse("Transactions", { type: "object", properties: { transactions: { type: "array" }, total: { type: "integer" } } }) },
        },
      },
      "/admin/ledger/transactions/{id}": {
        get: {
          tags: ["Ledger"],
          operationId: "getLedgerTransaction",
          summary: "Get ledger transaction details",
          parameters: [pathParam("id", "Transaction ID")],
          responses: { "200": jsonResponse("Transaction details", { type: "object" }), "404": problemResponse("Transaction not found") },
        },
      },
      "/admin/ledger/reconcile": {
        post: {
          tags: ["Ledger"],
          operationId: "reconcileLedger",
          summary: "Run ledger reconciliation",
          responses: { "200": jsonResponse("Reconciliation result", { type: "object" }) },
        },
      },

      // --- Settlements ---
      "/admin/settlements": {
        get: {
          tags: ["Settlements"],
          operationId: "listSettlements",
          summary: "List settlements",
          parameters: [queryParam("limit", "Max results", "integer", 20), queryParam("offset", "Offset", "integer", 0)],
          responses: { "200": jsonResponse("Settlement list", { type: "object", properties: { settlements: { type: "array" }, total: { type: "integer" } } }) },
        },
        post: {
          tags: ["Settlements"],
          operationId: "createSettlement",
          summary: "Create a new settlement",
          requestBody: jsonBody({
            type: "object",
            required: ["merchantAccountId", "periodStart", "periodEnd"],
            properties: {
              merchantAccountId: { type: "string" },
              periodStart: { type: "string", format: "date-time" },
              periodEnd: { type: "string", format: "date-time" },
            },
          }),
          responses: { "201": jsonResponse("Settlement created", { type: "object" }) },
        },
      },
      "/admin/settlements/{id}": {
        get: {
          tags: ["Settlements"],
          operationId: "getSettlement",
          summary: "Get settlement details",
          parameters: [pathParam("id", "Settlement ID")],
          responses: { "200": jsonResponse("Settlement", { type: "object" }), "404": problemResponse("Settlement not found") },
        },
      },
      "/admin/settlements/{id}/approve": {
        post: {
          tags: ["Settlements"],
          operationId: "approveSettlement",
          summary: "Approve a settlement",
          parameters: [pathParam("id", "Settlement ID")],
          responses: { "200": jsonResponse("Approved", { type: "object" }) },
        },
      },
      "/admin/settlements/{id}/process": {
        post: {
          tags: ["Settlements"],
          operationId: "processSettlement",
          summary: "Process an approved settlement",
          parameters: [pathParam("id", "Settlement ID")],
          responses: { "200": jsonResponse("Processed", { type: "object" }) },
        },
      },
      "/admin/settlements/{id}/report": {
        get: {
          tags: ["Settlements"],
          operationId: "getSettlementReport",
          summary: "Get settlement report",
          parameters: [pathParam("id", "Settlement ID")],
          responses: { "200": jsonResponse("Report", { type: "object" }) },
        },
      },
      "/admin/settlements/{id}/export": {
        get: {
          tags: ["Settlements"],
          operationId: "exportSettlement",
          summary: "Export settlement as CSV",
          parameters: [pathParam("id", "Settlement ID")],
          responses: { "200": { description: "CSV file", content: { "text/csv": { schema: { type: "string" } } } } },
        },
      },

      // --- Subscriptions ---
      "/admin/subscriptions/plans": {
        get: {
          tags: ["Subscriptions"],
          operationId: "listPlans",
          summary: "List subscription plans",
          responses: { "200": jsonResponse("Plans", { type: "object", properties: { plans: { type: "array" } } }) },
        },
        post: {
          tags: ["Subscriptions"],
          operationId: "createPlan",
          summary: "Create a subscription plan",
          requestBody: jsonBody({
            type: "object",
            required: ["name", "amount", "currency", "interval"],
            properties: {
              name: { type: "string" },
              amount: { type: "integer", description: "Amount in cents" },
              currency: { type: "string" },
              interval: { type: "string", enum: ["monthly", "yearly"] },
              trialDays: { type: "integer" },
            },
          }),
          responses: { "201": jsonResponse("Plan created", { type: "object" }) },
        },
      },
      "/admin/subscriptions/plans/{id}": {
        get: {
          tags: ["Subscriptions"],
          operationId: "getPlan",
          summary: "Get plan details",
          parameters: [pathParam("id", "Plan ID")],
          responses: { "200": jsonResponse("Plan", { type: "object" }), "404": problemResponse("Plan not found") },
        },
        delete: {
          tags: ["Subscriptions"],
          operationId: "deletePlan",
          summary: "Delete a subscription plan",
          parameters: [pathParam("id", "Plan ID")],
          responses: { "200": jsonResponse("Deleted", { type: "object", properties: { success: { type: "boolean" } } }) },
        },
      },
      "/admin/subscriptions": {
        get: {
          tags: ["Subscriptions"],
          operationId: "listSubscriptions",
          summary: "List subscriptions",
          parameters: [queryParam("status", "Filter by status")],
          responses: { "200": jsonResponse("Subscriptions", { type: "object", properties: { subscriptions: { type: "array" } } }) },
        },
        post: {
          tags: ["Subscriptions"],
          operationId: "createSubscription",
          summary: "Create a subscription",
          requestBody: jsonBody({
            type: "object",
            required: ["customerId", "planId"],
            properties: {
              customerId: { type: "string" },
              planId: { type: "string" },
              trialDays: { type: "integer" },
            },
          }),
          responses: { "201": jsonResponse("Subscription created", { type: "object" }) },
        },
      },
      "/admin/subscriptions/{id}": {
        get: {
          tags: ["Subscriptions"],
          operationId: "getSubscription",
          summary: "Get subscription details",
          parameters: [pathParam("id", "Subscription ID")],
          responses: { "200": jsonResponse("Subscription", { type: "object" }) },
        },
      },
      "/admin/subscriptions/{id}/cancel": {
        post: {
          tags: ["Subscriptions"],
          operationId: "cancelSubscription",
          summary: "Cancel a subscription",
          parameters: [pathParam("id", "Subscription ID")],
          requestBody: jsonBody({ type: "object", properties: { reason: { type: "string" }, immediate: { type: "boolean" } } }),
          responses: { "200": jsonResponse("Canceled", { type: "object" }) },
        },
      },
      "/admin/subscriptions/{id}/upgrade": {
        post: {
          tags: ["Subscriptions"],
          operationId: "upgradeSubscription",
          summary: "Upgrade to a higher plan",
          parameters: [pathParam("id", "Subscription ID")],
          requestBody: jsonBody({ type: "object", required: ["newPlanId"], properties: { newPlanId: { type: "string" } } }),
          responses: { "200": jsonResponse("Upgraded", { type: "object" }) },
        },
      },
      "/admin/subscriptions/{id}/downgrade": {
        post: {
          tags: ["Subscriptions"],
          operationId: "downgradeSubscription",
          summary: "Downgrade to a lower plan",
          parameters: [pathParam("id", "Subscription ID")],
          requestBody: jsonBody({ type: "object", required: ["newPlanId"], properties: { newPlanId: { type: "string" } } }),
          responses: { "200": jsonResponse("Downgraded", { type: "object" }) },
        },
      },
      "/admin/subscriptions/{id}/pause": {
        post: {
          tags: ["Subscriptions"],
          operationId: "pauseSubscription",
          summary: "Pause a subscription",
          parameters: [pathParam("id", "Subscription ID")],
          responses: { "200": jsonResponse("Paused", { type: "object" }) },
        },
      },
      "/admin/subscriptions/{id}/resume": {
        post: {
          tags: ["Subscriptions"],
          operationId: "resumeSubscription",
          summary: "Resume a paused subscription",
          parameters: [pathParam("id", "Subscription ID")],
          responses: { "200": jsonResponse("Resumed", { type: "object" }) },
        },
      },
      "/admin/subscriptions/{id}/upcoming-invoice": {
        get: {
          tags: ["Subscriptions"],
          operationId: "getUpcomingInvoice",
          summary: "Preview the next invoice for a subscription",
          parameters: [pathParam("id", "Subscription ID")],
          responses: { "200": jsonResponse("Upcoming invoice", { type: "object" }) },
        },
      },
      "/admin/subscriptions/{id}/events": {
        get: {
          tags: ["Subscriptions"],
          operationId: "getSubscriptionEvents",
          summary: "Get subscription event history",
          parameters: [pathParam("id", "Subscription ID")],
          responses: { "200": jsonResponse("Events", { type: "array", items: { type: "object" } }) },
        },
      },

      // --- Invoices ---
      "/admin/invoices": {
        get: {
          tags: ["Invoices"],
          operationId: "listInvoices",
          summary: "List invoices",
          parameters: [queryParam("status", "Filter by status"), queryParam("subscriptionId", "Filter by subscription")],
          responses: { "200": jsonResponse("Invoices", { type: "object", properties: { invoices: { type: "array" } } }) },
        },
      },
      "/admin/invoices/{id}": {
        get: {
          tags: ["Invoices"],
          operationId: "getInvoice",
          summary: "Get invoice details",
          parameters: [pathParam("id", "Invoice ID")],
          responses: { "200": jsonResponse("Invoice", { type: "object" }), "404": problemResponse("Invoice not found") },
        },
      },
      "/admin/invoices/{id}/pay": {
        post: {
          tags: ["Invoices"],
          operationId: "payInvoice",
          summary: "Pay an invoice",
          parameters: [pathParam("id", "Invoice ID")],
          responses: { "200": jsonResponse("Paid invoice", { type: "object" }) },
        },
      },
      "/admin/invoices/{id}/void": {
        post: {
          tags: ["Invoices"],
          operationId: "voidInvoice",
          summary: "Void an invoice",
          parameters: [pathParam("id", "Invoice ID")],
          responses: { "200": jsonResponse("Voided invoice", { type: "object" }) },
        },
      },

      // --- Billing ---
      "/admin/billing/process": {
        post: {
          tags: ["Billing"],
          operationId: "processDueSubscriptions",
          summary: "Process all due subscription billings",
          responses: { "200": jsonResponse("Processing result", { type: "object", properties: { processed: { type: "integer" } } }) },
        },
      },

      // --- Dunning ---
      "/admin/dunning/config": {
        get: {
          tags: ["Dunning"],
          operationId: "getDunningConfig",
          summary: "Get dunning configuration",
          responses: { "200": jsonResponse("Dunning config", { type: "object" }) },
        },
        put: {
          tags: ["Dunning"],
          operationId: "updateDunningConfig",
          summary: "Update dunning configuration",
          requestBody: jsonBody({
            type: "object",
            properties: {
              maxRetries: { type: "integer" },
              retryIntervalDays: { type: "array", items: { type: "integer" } },
              cancelAfterMaxRetries: { type: "boolean" },
            },
          }),
          responses: { "200": jsonResponse("Updated config", { type: "object" }) },
        },
      },
      "/admin/dunning/active": {
        get: {
          tags: ["Dunning"],
          operationId: "getActiveDunning",
          summary: "List active dunning flows",
          responses: { "200": jsonResponse("Active flows", { type: "object", properties: { flows: { type: "array" } } }) },
        },
      },
      "/admin/dunning/process": {
        post: {
          tags: ["Dunning"],
          operationId: "processDunning",
          summary: "Process pending dunning retries",
          responses: { "200": jsonResponse("Processing result", { type: "object", properties: { processed: { type: "integer" } } }) },
        },
      },
      "/admin/dunning/analytics": {
        get: {
          tags: ["Dunning"],
          operationId: "getDunningAnalytics",
          summary: "Get dunning analytics",
          responses: { "200": jsonResponse("Analytics", { type: "object" }) },
        },
      },

      // --- Disputes ---
      "/admin/disputes": {
        get: {
          tags: ["Disputes"],
          operationId: "listDisputes",
          summary: "List disputes",
          parameters: [queryParam("status", "Filter by status"), queryParam("paymentId", "Filter by payment"), queryParam("limit", "Max results", "integer", 20), queryParam("offset", "Offset", "integer", 0)],
          responses: { "200": jsonResponse("Disputes", { type: "object", properties: { disputes: { type: "array" }, total: { type: "integer" } } }) },
        },
        post: {
          tags: ["Disputes"],
          operationId: "receiveDispute",
          summary: "Receive a dispute/chargeback",
          requestBody: jsonBody({
            type: "object",
            required: ["paymentId", "reason", "amount"],
            properties: {
              paymentId: { type: "string" },
              reason: { type: "string" },
              amount: { type: "integer" },
              type: { type: "string", enum: ["chargeback", "inquiry", "pre_arbitration"] },
            },
          }),
          responses: { "201": jsonResponse("Dispute created", { type: "object" }) },
        },
      },
      "/admin/disputes/chargeback-rate": {
        get: {
          tags: ["Disputes"],
          operationId: "getChargebackRate",
          summary: "Get chargeback rate",
          parameters: [queryParam("merchantAccountId", "Filter by merchant")],
          responses: { "200": jsonResponse("Chargeback rate", { type: "object" }) },
        },
      },
      "/admin/disputes/{id}": {
        get: {
          tags: ["Disputes"],
          operationId: "getDispute",
          summary: "Get dispute details",
          parameters: [pathParam("id", "Dispute ID")],
          responses: { "200": jsonResponse("Dispute", { type: "object" }), "404": problemResponse("Dispute not found") },
        },
      },
      "/admin/disputes/{id}/evidence": {
        post: {
          tags: ["Disputes"],
          operationId: "submitDisputeEvidence",
          summary: "Submit evidence for a dispute",
          parameters: [pathParam("id", "Dispute ID")],
          requestBody: jsonBody({
            type: "object",
            properties: {
              description: { type: "string" },
              customerCommunication: { type: "string" },
              shippingProof: { type: "string" },
              refundPolicy: { type: "string" },
            },
          }),
          responses: { "200": jsonResponse("Evidence submitted", { type: "object" }) },
        },
      },
      "/admin/disputes/{id}/resolve": {
        post: {
          tags: ["Disputes"],
          operationId: "resolveDispute",
          summary: "Resolve a dispute",
          parameters: [pathParam("id", "Dispute ID")],
          requestBody: jsonBody({ type: "object", required: ["outcome"], properties: { outcome: { type: "string", enum: ["won", "lost"] } } }),
          responses: { "200": jsonResponse("Resolved", { type: "object" }) },
        },
      },
      "/admin/disputes/{id}/accept": {
        post: {
          tags: ["Disputes"],
          operationId: "acceptDispute",
          summary: "Accept a dispute (concede)",
          parameters: [pathParam("id", "Dispute ID")],
          responses: { "200": jsonResponse("Accepted", { type: "object" }) },
        },
      },

      // --- Split Payments ---
      "/admin/splits": {
        post: {
          tags: ["Split Payments"],
          operationId: "configureSplits",
          summary: "Configure payment splits",
          requestBody: jsonBody({
            type: "object",
            required: ["paymentId", "amount", "splits"],
            properties: {
              paymentId: { type: "string" },
              amount: { type: "integer" },
              splits: { type: "array", items: { type: "object", properties: { merchantAccountId: { type: "string" }, amount: { type: "integer" } } } },
            },
          }),
          responses: { "201": jsonResponse("Splits configured", { type: "object" }) },
        },
      },
      "/admin/splits/{paymentId}/execute": {
        post: {
          tags: ["Split Payments"],
          operationId: "executeSplits",
          summary: "Execute configured splits",
          parameters: [pathParam("paymentId", "Payment ID")],
          responses: { "200": jsonResponse("Splits executed", { type: "object" }) },
        },
      },
      "/admin/splits/{paymentId}": {
        get: {
          tags: ["Split Payments"],
          operationId: "getSplits",
          summary: "Get splits for a payment",
          parameters: [pathParam("paymentId", "Payment ID")],
          responses: { "200": jsonResponse("Payment splits", { type: "array", items: { type: "object" } }) },
        },
      },

      // --- Payout Accounts ---
      "/admin/payout-accounts": {
        get: {
          tags: ["Payouts"],
          operationId: "listPayoutAccounts",
          summary: "List payout accounts",
          parameters: [queryParam("merchantAccountId", "Filter by merchant")],
          responses: { "200": jsonResponse("Payout accounts", { type: "array", items: { type: "object" } }) },
        },
        post: {
          tags: ["Payouts"],
          operationId: "createPayoutAccount",
          summary: "Add a payout account",
          requestBody: jsonBody({
            type: "object",
            required: ["merchantAccountId", "type", "bankName", "accountNumber", "routingNumber", "country"],
            properties: {
              merchantAccountId: { type: "string" },
              type: { type: "string" },
              bankName: { type: "string" },
              accountNumber: { type: "string" },
              routingNumber: { type: "string" },
              country: { type: "string" },
            },
          }),
          responses: { "201": jsonResponse("Account created", { type: "object" }) },
        },
      },
      "/admin/payout-accounts/{id}": {
        delete: {
          tags: ["Payouts"],
          operationId: "deletePayoutAccount",
          summary: "Remove a payout account",
          parameters: [pathParam("id", "Account ID")],
          responses: { "200": jsonResponse("Deleted", { type: "object" }) },
        },
      },
      "/admin/payout-accounts/{id}/default": {
        post: {
          tags: ["Payouts"],
          operationId: "setDefaultPayoutAccount",
          summary: "Set default payout account",
          parameters: [pathParam("id", "Account ID")],
          responses: { "200": jsonResponse("Updated", { type: "object" }) },
        },
      },

      // --- Payouts ---
      "/admin/payouts": {
        get: {
          tags: ["Payouts"],
          operationId: "listPayouts",
          summary: "List payouts",
          parameters: [queryParam("merchantAccountId", "Filter by merchant"), queryParam("status", "Filter by status"), queryParam("limit", "Max results", "integer", 20), queryParam("offset", "Offset", "integer", 0)],
          responses: { "200": jsonResponse("Payouts", { type: "object", properties: { payouts: { type: "array" }, total: { type: "integer" } } }) },
        },
        post: {
          tags: ["Payouts"],
          operationId: "createPayout",
          summary: "Initiate a payout",
          requestBody: jsonBody({
            type: "object",
            required: ["merchantAccountId", "amount", "currency"],
            properties: {
              merchantAccountId: { type: "string" },
              amount: { type: "integer" },
              currency: { type: "string" },
            },
          }),
          responses: { "201": jsonResponse("Payout created", { type: "object" }) },
        },
      },
      "/admin/payouts/{id}": {
        get: {
          tags: ["Payouts"],
          operationId: "getPayout",
          summary: "Get payout details",
          parameters: [pathParam("id", "Payout ID")],
          responses: { "200": jsonResponse("Payout", { type: "object" }), "404": problemResponse("Payout not found") },
        },
      },

      // --- 3D Secure ---
      "/admin/3ds/check": {
        post: {
          tags: ["3D Secure"],
          operationId: "check3dsRequired",
          summary: "Check if 3DS is required",
          requestBody: jsonBody({
            type: "object",
            properties: {
              amount: { type: "integer" },
              currency: { type: "string" },
              region: { type: "string" },
              fraudScore: { type: "number" },
              trustedBeneficiary: { type: "boolean" },
            },
          }),
          responses: { "200": jsonResponse("3DS check result", { type: "object", properties: { required: { type: "boolean" }, reason: { type: "string" } } }) },
        },
      },
      "/admin/3ds/initiate": {
        post: {
          tags: ["3D Secure"],
          operationId: "initiate3ds",
          summary: "Initiate a 3DS authentication",
          requestBody: jsonBody({
            type: "object",
            required: ["paymentId"],
            properties: {
              paymentId: { type: "string" },
              version: { type: "string", enum: ["3ds1", "3ds2"] },
              amount: { type: "integer" },
              currency: { type: "string" },
              region: { type: "string" },
              fraudScore: { type: "number" },
            },
          }),
          responses: { "201": jsonResponse("3DS initiated", { type: "object" }) },
        },
      },
      "/admin/3ds/{id}/complete": {
        post: {
          tags: ["3D Secure"],
          operationId: "complete3ds",
          summary: "Complete a 3DS authentication",
          parameters: [pathParam("id", "3DS record ID")],
          requestBody: jsonBody({
            type: "object",
            required: ["outcome"],
            properties: {
              outcome: { type: "string", enum: ["authenticated", "failed"] },
            },
          }),
          responses: { "200": jsonResponse("3DS completed", { type: "object" }) },
        },
      },
      "/admin/3ds/payment/{paymentId}": {
        get: {
          tags: ["3D Secure"],
          operationId: "get3dsForPayment",
          summary: "Get 3DS record for a payment",
          parameters: [pathParam("paymentId", "Payment ID")],
          responses: { "200": jsonResponse("3DS record", { type: "object" }) },
        },
      },

      // --- Payment Methods ---
      "/admin/payment-methods": {
        get: {
          tags: ["Payment Methods"],
          operationId: "listPaymentMethods",
          summary: "List stored payment methods",
          parameters: [queryParam("customerId", "Filter by customer")],
          responses: { "200": jsonResponse("Payment methods", { type: "array", items: { type: "object" } }) },
        },
        post: {
          tags: ["Payment Methods"],
          operationId: "createPaymentMethod",
          summary: "Store a new payment method",
          requestBody: jsonBody({
            type: "object",
            required: ["type", "customerId"],
            properties: {
              type: { type: "string", enum: ["card", "bank_transfer", "wallet", "bnpl", "crypto"] },
              customerId: { type: "string" },
              cardLast4: { type: "string" },
              cardBrand: { type: "string" },
              bankType: { type: "string" },
              walletProvider: { type: "string" },
              bnplProvider: { type: "string" },
              cryptoCurrency: { type: "string" },
            },
          }),
          responses: { "201": jsonResponse("Payment method created", { type: "object" }) },
        },
      },
      "/admin/payment-methods/supported": {
        get: {
          tags: ["Payment Methods"],
          operationId: "getSupportedPaymentMethods",
          summary: "Get supported payment methods by currency/country",
          parameters: [queryParam("currency", "Currency code"), queryParam("country", "Country code")],
          responses: { "200": jsonResponse("Supported methods", { type: "array", items: { type: "object" } }) },
        },
      },
      "/admin/payment-methods/{id}": {
        get: {
          tags: ["Payment Methods"],
          operationId: "getPaymentMethod",
          summary: "Get payment method details",
          parameters: [pathParam("id", "Payment method ID")],
          responses: { "200": jsonResponse("Payment method", { type: "object" }), "404": problemResponse("Not found") },
        },
      },
      "/admin/payment-methods/{id}/default": {
        post: {
          tags: ["Payment Methods"],
          operationId: "setDefaultPaymentMethod",
          summary: "Set as default payment method",
          parameters: [pathParam("id", "Payment method ID")],
          responses: { "200": jsonResponse("Updated", { type: "object" }) },
        },
      },
      "/admin/payment-methods/{id}/revoke": {
        post: {
          tags: ["Payment Methods"],
          operationId: "revokePaymentMethod",
          summary: "Revoke a payment method",
          parameters: [pathParam("id", "Payment method ID")],
          responses: { "200": jsonResponse("Revoked", { type: "object" }), "404": problemResponse("Not found") },
        },
      },

      // --- Checkout ---
      "/checkout/sessions": {
        get: {
          tags: ["Checkout"],
          operationId: "listCheckoutSessions",
          summary: "List checkout sessions",
          parameters: [queryParam("status", "Filter by status"), queryParam("limit", "Max results", "integer", 20)],
          responses: { "200": jsonResponse("Sessions", { type: "array", items: { type: "object" } }) },
        },
        post: {
          tags: ["Checkout"],
          operationId: "createCheckoutSession",
          summary: "Create a checkout session",
          requestBody: jsonBody({
            type: "object",
            required: ["amount", "currency"],
            properties: {
              amount: { type: "integer" },
              currency: { type: "string" },
              description: { type: "string" },
              successUrl: { type: "string" },
              cancelUrl: { type: "string" },
              customer: { type: "object", properties: { email: { type: "string" }, name: { type: "string" } } },
              lineItems: { type: "array", items: { type: "object" } },
              allowedPaymentMethods: { type: "array", items: { type: "string" } },
              expiresInMinutes: { type: "integer", default: 30 },
            },
          }),
          responses: { "201": jsonResponse("Session created", { type: "object" }) },
        },
      },
      "/checkout/sessions/{id}": {
        get: {
          tags: ["Checkout"],
          operationId: "getCheckoutSession",
          summary: "Get checkout session details",
          parameters: [pathParam("id", "Session ID")],
          responses: { "200": jsonResponse("Session", { type: "object" }), "404": problemResponse("Not found") },
        },
      },
      "/checkout/sessions/{id}/complete": {
        post: {
          tags: ["Checkout"],
          operationId: "completeCheckoutSession",
          summary: "Complete a checkout session",
          parameters: [pathParam("id", "Session ID")],
          requestBody: jsonBody({
            type: "object",
            required: ["paymentId"],
            properties: {
              paymentId: { type: "string" },
              paymentMethodType: { type: "string" },
            },
          }),
          responses: { "200": jsonResponse("Completed", { type: "object" }) },
        },
      },
      "/checkout/sessions/{id}/expire": {
        post: {
          tags: ["Checkout"],
          operationId: "expireCheckoutSession",
          summary: "Expire a checkout session",
          parameters: [pathParam("id", "Session ID")],
          responses: { "200": jsonResponse("Expired", { type: "object" }) },
        },
      },
      "/checkout/analytics": {
        get: {
          tags: ["Checkout"],
          operationId: "getCheckoutAnalytics",
          summary: "Get checkout conversion analytics",
          responses: { "200": jsonResponse("Analytics", { type: "object" }) },
        },
      },

      // --- Sandbox ---
      "/admin/sandbox/test-cards": {
        get: {
          tags: ["Sandbox"],
          operationId: "listTestCards",
          summary: "List all test card numbers with behaviors",
          responses: {
            "200": jsonResponse("Test cards", {
              type: "object",
              properties: {
                cards: {
                  type: "array",
                  items: { $ref: "#/components/schemas/TestCard" },
                },
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
            properties: {
              paymentId: { type: "string" },
            },
          }),
          responses: {
            "200": jsonResponse("Dispute triggered", {
              type: "object",
              properties: {
                disputeId: { type: "string" },
                paymentId: { type: "string" },
              },
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

      // --- Webhook Catalog ---
      "/admin/webhook-catalog": {
        get: {
          tags: ["Webhook Catalog"],
          operationId: "listWebhookEvents",
          summary: "List all webhook event type definitions",
          parameters: [queryParam("category", "Filter by category (payment, subscription, dispute, payout, merchant)")],
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

      // --- API Keys (auth-routes) ---
      "/api-keys": {
        get: {
          tags: ["API Keys"],
          operationId: "listApiKeys",
          summary: "List API keys for tenant",
          responses: { "200": jsonResponse("API keys", { type: "object" }) },
        },
        post: {
          tags: ["API Keys"],
          operationId: "createApiKey",
          summary: "Generate a new API key",
          requestBody: jsonBody({
            type: "object",
            required: ["environment"],
            properties: {
              environment: { type: "string", enum: ["sandbox", "production"] },
              name: { type: "string" },
              permissions: { type: "array", items: { type: "string" } },
            },
          }),
          responses: { "201": jsonResponse("API key created", { type: "object", properties: { key: { type: "string" }, id: { type: "string" }, prefix: { type: "string" }, environment: { type: "string" } } }) },
        },
      },
      "/api-keys/{id}": {
        delete: {
          tags: ["API Keys"],
          operationId: "revokeApiKey",
          summary: "Revoke an API key",
          parameters: [pathParam("id", "API key ID")],
          responses: { "204": { description: "Key revoked" }, "404": problemResponse("Key not found") },
        },
      },

      // --- Team ---
      "/team": {
        get: {
          tags: ["Team"],
          operationId: "listTeamMembers",
          summary: "List team members and pending invites",
          responses: { "200": jsonResponse("Team", { type: "object" }) },
        },
      },
      "/team/invite": {
        post: {
          tags: ["Team"],
          operationId: "inviteTeamMember",
          summary: "Invite a new team member",
          requestBody: jsonBody({
            type: "object",
            required: ["email", "role"],
            properties: {
              email: { type: "string", format: "email" },
              role: { type: "string", enum: ["admin", "developer", "viewer"] },
            },
          }),
          responses: { "201": jsonResponse("Invite sent", { type: "object" }) },
        },
      },
      "/team/invite/accept": {
        post: {
          tags: ["Team"],
          operationId: "acceptInvite",
          summary: "Accept a team invitation",
          security: [],
          requestBody: jsonBody({
            type: "object",
            required: ["token", "name", "password"],
            properties: {
              token: { type: "string" },
              name: { type: "string" },
              password: { type: "string" },
            },
          }),
          responses: { "200": jsonResponse("Invite accepted", { type: "object" }), "410": problemResponse("Invite expired") },
        },
      },
      "/team/{memberId}/role": {
        patch: {
          tags: ["Team"],
          operationId: "changeTeamRole",
          summary: "Change a team member's role",
          parameters: [pathParam("memberId", "Member ID")],
          requestBody: jsonBody({ type: "object", required: ["role"], properties: { role: { type: "string" } } }),
          responses: { "200": jsonResponse("Role updated", { type: "object" }), "404": problemResponse("Member not found") },
        },
      },

      // --- Onboarding ---
      "/onboarding/kyb": {
        get: {
          tags: ["Onboarding"],
          operationId: "getKybStatus",
          summary: "Get KYB application status",
          responses: { "200": jsonResponse("KYB status", { type: "object" }) },
        },
        post: {
          tags: ["Onboarding"],
          operationId: "submitKyb",
          summary: "Submit KYB (Know Your Business) application",
          requestBody: jsonBody({
            type: "object",
            required: ["businessName", "businessType", "country"],
            properties: {
              businessName: { type: "string" },
              businessType: { type: "string" },
              country: { type: "string" },
              registrationNumber: { type: "string" },
              taxId: { type: "string" },
              website: { type: "string" },
            },
          }),
          responses: { "201": jsonResponse("KYB submitted", { type: "object" }) },
        },
      },
      "/onboarding/configure": {
        post: {
          tags: ["Onboarding"],
          operationId: "configureOnboarding",
          summary: "Configure merchant settings",
          requestBody: jsonBody({
            type: "object",
            properties: {
              fraudSensitivity: { type: "string" },
              settlementCurrency: { type: "string" },
              payoutSchedule: { type: "string" },
            },
          }),
          responses: { "200": jsonResponse("Configured", { type: "object", properties: { success: { type: "boolean" } } }) },
        },
      },
      "/onboarding/go-live": {
        post: {
          tags: ["Onboarding"],
          operationId: "goLive",
          summary: "Activate merchant account for production",
          responses: { "200": jsonResponse("Live", { type: "object" }), "422": problemResponse("KYB not approved") },
        },
      },

      // --- Experiments ---
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

      // --- Reports ---
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

      // --- Analytics ---
      "/admin/analytics/revenue": {
        get: {
          tags: ["Analytics"],
          operationId: "getRevenueAnalytics",
          summary: "Get revenue analytics",
          parameters: [queryParam("from", "Start date"), queryParam("to", "End date"), queryParam("granularity", "Time granularity")],
          responses: { "200": jsonResponse("Revenue data", { type: "object" }) },
        },
      },
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "API key passed as Bearer token. Generate keys via POST /api-keys.",
        },
      },
      schemas: {
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
            status: { type: "string", enum: ["pending", "validating", "reserving_inventory", "charging", "notifying", "completed", "failed", "compensating", "compensated"] },
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
        FraudRule: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            ruleType: { type: "string" },
            config: { type: "object" },
            weight: { type: "integer" },
            enabled: { type: "boolean" },
          },
        },
        FraudRuleInput: {
          type: "object",
          required: ["name", "ruleType"],
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            ruleType: { type: "string" },
            config: { type: "object" },
            weight: { type: "integer" },
            enabled: { type: "boolean" },
          },
        },
        FraudEvaluation: {
          type: "object",
          properties: {
            paymentId: { type: "string" },
            score: { type: "number" },
            action: { type: "string", enum: ["allow", "review", "block"] },
            reasons: { type: "array", items: { type: "string" } },
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
        LedgerAccount: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            type: { type: "string" },
            currency: { type: "string" },
            balance: { type: "integer" },
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
        RegisterResponse: {
          type: "object",
          properties: {
            token: { type: "string" },
            user: { $ref: "#/components/schemas/User" },
            tenant: { $ref: "#/components/schemas/Tenant" },
            apiKey: { type: "object", properties: { prefix: { type: "string" }, environment: { type: "string" } } },
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
        TestCard: {
          type: "object",
          properties: {
            number: { type: "string" },
            behavior: { type: "string" },
            description: { type: "string" },
            declineCode: { type: "string" },
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
      },
      headers: {
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
      },
    },
  };
}

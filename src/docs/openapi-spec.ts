/**
 * OpenAPI 3.1 specification for the Payment Orchestrator API.
 *
 * Hand-crafted as a TypeScript object so it stays co-located with the code
 * and benefits from type checking. Served at /openapi.json.
 *
 * Composed from domain-specific modules in ./schemas/.
 */

import { buildAdminPaths, buildAdminSchemas } from "./schemas/admin-schemas.js";
import { buildAuthPaths } from "./schemas/auth-schemas.js";
import { buildBillingPaths } from "./schemas/billing-schemas.js";
import { buildCommonHeaders, buildCommonSchemas, buildSecuritySchemes } from "./schemas/common-schemas.js";
import { buildFinancialPaths, buildFinancialSchemas } from "./schemas/financial-schemas.js";
import { buildFraudPaths, buildFraudSchemas } from "./schemas/fraud-schemas.js";
import { buildPaymentPaths, buildPaymentSchemas } from "./schemas/payment-schemas.js";
import { buildProviderPaths, buildProviderSchemas } from "./schemas/provider-schemas.js";
import { buildWebhookPaths, buildWebhookSchemas } from "./schemas/webhook-schemas.js";

export interface OpenAPISpec {
  openapi: string;
  info: Record<string, unknown>;
  servers: Record<string, unknown>[];
  security: Record<string, unknown[]>[];
  tags: { name: string; description: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, unknown>;
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
    servers: [{ url: "http://localhost:3000", description: "Local development" }],
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
      ...buildPaymentPaths(),
      ...buildAuthPaths(),
      ...buildWebhookPaths(),
      ...buildFraudPaths(),
      ...buildProviderPaths(),
      ...buildAdminPaths(),
      ...buildBillingPaths(),
      ...buildFinancialPaths(),
    },
    components: {
      securitySchemes: buildSecuritySchemes(),
      schemas: {
        ...buildCommonSchemas(),
        ...buildPaymentSchemas(),
        ...buildWebhookSchemas(),
        ...buildFraudSchemas(),
        ...buildProviderSchemas(),
        ...buildAdminSchemas(),
        ...buildFinancialSchemas(),
      },
      headers: buildCommonHeaders(),
    },
  };
}

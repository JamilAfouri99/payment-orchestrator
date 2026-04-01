# Phase 8: Developer Experience — API Documentation, Sandbox, Webhook Catalog & CLI

## Overview

Phase 8 transforms the payment orchestrator from an internal tool into a developer-friendly platform. Four sub-features:

- **8A: OpenAPI Specification** — Auto-generated OpenAPI 3.1 spec served as interactive docs (Swagger UI + Redoc)
- **8B: Sandbox Environment** — Test card numbers with deterministic behaviors, isolated sandbox mode
- **8C: Webhook Event Catalog** — Standardized webhook event definitions with payload schemas and HMAC docs
- **8D: CLI Tool** — `bin/payorchestrate` for merchant developers to interact with the API from the terminal

## 8A: OpenAPI 3.1 Specification

### Approach

Hand-craft a comprehensive OpenAPI 3.1 spec as a TypeScript object (not YAML file) so it stays co-located with the code and benefits from type safety. Serve it at `/openapi.json` and mount Swagger UI at `/docs` and Redoc at `/redoc`.

### Spec Structure

```
openapi: 3.1.0
info:
  title: Payment Orchestrator API
  version: 1.0.0
  description: Production-grade payment processing API

servers:
  - url: http://localhost:3000
    description: Local development

security:
  - BearerAuth: []

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      description: API key in Bearer header

  schemas:
    ProblemDetails (RFC 7807)
    PaymentRequest, PaymentState, OrderItem, CardDetails
    DomainEvent, PaymentEventType
    WebhookRegistration, WebhookDelivery
    FraudRule, FraudEvaluation
    PaymentToken
    FxRate
    LedgerAccount, LedgerTransaction
    Settlement
    Plan, Subscription, Invoice
    DunningConfig
    Dispute, DisputeEvidence
    PaymentSplit
    PayoutAccount, Payout
    ThreeDSecureRecord
    PaymentMethodRecord
    CheckoutSession
    WebhookEvent (catalog entry)
    SandboxTestCard

  headers:
    X-Request-ID, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset

paths:
  All ~150 endpoints documented with:
  - operationId
  - summary + description
  - parameters (path, query)
  - requestBody with schema + example
  - responses (success + error cases)
  - tags for grouping
```

### Tags (Endpoint Grouping)

| Tag | Prefix | Count |
|-----|--------|-------|
| Health | `/health` | 1 |
| Authentication | `/auth/*` | 5 |
| Onboarding | `/onboarding/*` | 4 |
| API Keys | `/api-keys` | 3 |
| Team | `/team/*` | 4 |
| Payments | `/payments` | 6 |
| Webhooks | `/webhooks/*` | 6 |
| Chaos Engineering | `/admin/chaos` | 3 |
| Circuit Breakers | `/admin/circuit-breakers` | 2 |
| Metrics | `/admin/metrics` | 2 |
| Logs | `/admin/logs` | 1 |
| Bulkheads | `/admin/bulkheads` | 1 |
| Saga Recovery | `/admin/saga-recovery` | 1 |
| Providers | `/admin/providers` | 4 |
| Fraud | `/admin/fraud/*` | 6 |
| Tokens | `/tokens` | 3 |
| FX Rates | `/admin/fx/*` | 2 |
| Decline Codes | `/admin/decline-codes` | 1 |
| Ledger | `/admin/ledger/*` | 6 |
| Settlements | `/admin/settlements/*` | 6 |
| Subscriptions | `/admin/subscriptions/*` | 11 |
| Invoices | `/admin/invoices/*` | 4 |
| Billing | `/admin/billing/*` | 1 |
| Dunning | `/admin/dunning/*` | 4 |
| Disputes | `/admin/disputes/*` | 6 |
| Split Payments | `/admin/splits/*` | 3 |
| Payouts | `/admin/payouts/*` | 5 |
| 3D Secure | `/admin/3ds/*` | 4 |
| Payment Methods | `/admin/payment-methods/*` | 6 |
| Checkout | `/checkout/*` | 6 |
| Sandbox | `/admin/sandbox/*` | 3 |
| Webhook Catalog | `/admin/webhook-catalog` | 1 |

### Dependencies

- `swagger-ui-express` — Swagger UI middleware
- No Redoc dependency — serve Redoc via CDN HTML page

### Files

- `src/docs/openapi-spec.ts` — OpenAPI 3.1 spec object
- `src/docs/docs-routes.ts` — Express router mounting `/docs`, `/redoc`, `/openapi.json`

## 8B: Sandbox Environment

### Test Card Numbers

| Card Number | Behavior | Description |
|-------------|----------|-------------|
| `4242424242424242` | Always succeeds | Standard success flow |
| `4000000000000002` | Always declines | Insufficient funds (hard decline) |
| `4000000000003220` | Triggers 3DS challenge | 3D Secure authentication required |
| `4000000000000069` | Timeout during processing | Simulates provider timeout |
| `4000000000000127` | Fraud block | High fraud score triggers block |
| `4000000000004954` | Succeeds then disputed | Payment succeeds, dispute created after 30s |
| `4000000000009995` | Soft decline then retry | First attempt declines, retry succeeds |

### Sandbox Detection

The existing `apiKeyAuthMiddleware` already sets `environment: "sandbox" | "production"` on `req.tenantContext`. Sandbox behavior triggers when `environment === "sandbox"`.

### Service Design

```typescript
interface SandboxService {
  isTestCard(pan: string): boolean;
  getTestCardBehavior(pan: string): TestCardBehavior | null;
  simulatePayment(pan: string, amount: number): SandboxPaymentResult;
  triggerDispute(paymentId: string): Promise<Result<Dispute, SandboxError>>;
  getTestCards(): TestCardInfo[];
}
```

### Sandbox Behaviors

- **Accelerated time**: Dunning retries in seconds instead of days (configurable multiplier)
- **Instant webhooks**: No backoff delay in sandbox mode
- **Isolated data**: Sandbox queries filtered by `environment = "sandbox"` (already present in tenant context)
- **Test card interception**: When `environment === "sandbox"` and card matches test card, bypass real provider routing and return deterministic result

### Event Types

| Event | When |
|-------|------|
| `SandboxPaymentSimulated` | Test card used in sandbox |
| `SandboxDisputeTriggered` | Manual dispute trigger in sandbox |

### REST Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/sandbox/test-cards` | List all test cards with behaviors |
| `POST` | `/admin/sandbox/trigger-dispute` | Trigger dispute on sandbox payment |
| `POST` | `/admin/sandbox/reset` | Clear all sandbox data for tenant |

## 8C: Webhook Event Catalog

### Event Categories

**Payment Events:**
- `payment.created` — Payment initiated
- `payment.authorized` — Payment charged successfully
- `payment.captured` — Payment completed (saga finished)
- `payment.failed` — Payment failed or compensation completed
- `payment.refunded` — Full refund processed
- `payment.partially_refunded` — Partial refund (split refund)

**Subscription Events:**
- `subscription.created` — New subscription created
- `subscription.activated` — Subscription active (first payment succeeded)
- `subscription.trial_ending` — Trial ends within 3 days
- `subscription.renewed` — Subscription renewed (billing cycle)
- `subscription.past_due` — Payment failed, entering dunning
- `subscription.canceled` — Subscription canceled
- `subscription.paused` — Subscription paused

**Dispute Events:**
- `dispute.created` — New dispute/chargeback received
- `dispute.evidence_required` — Evidence deadline approaching
- `dispute.won` — Dispute resolved in merchant's favor
- `dispute.lost` — Dispute resolved in cardholder's favor

**Payout Events:**
- `payout.created` — Payout initiated
- `payout.processing` — Payout being processed
- `payout.paid` — Payout delivered
- `payout.failed` — Payout failed

**Merchant Events:**
- `merchant.verified` — KYB approved, merchant verified
- `merchant.suspended` — Merchant account suspended

### Event Envelope Schema

```typescript
interface WebhookEvent {
  id: string;            // Unique event ID (idempotency key)
  type: string;          // e.g., "payment.created"
  apiVersion: string;    // "2024-01-01"
  createdAt: string;     // ISO 8601
  data: {
    object: Record<string, unknown>;  // Full resource
  };
}
```

### Webhook Headers

| Header | Description |
|--------|-------------|
| `X-Webhook-Signature` | HMAC-SHA256 hex digest |
| `X-Webhook-Timestamp` | ISO 8601 timestamp |
| `X-Webhook-ID` | Unique delivery ID |
| `Content-Type` | `application/json` |

### Service Design

```typescript
interface WebhookCatalog {
  getEvents(): WebhookEventDefinition[];
  getEvent(type: string): WebhookEventDefinition | null;
  getEventsByCategory(category: string): WebhookEventDefinition[];
  buildPayload(type: string, resource: Record<string, unknown>): WebhookEvent;
}
```

### REST Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/webhook-catalog` | List all event definitions |
| `GET` | `/admin/webhook-catalog/:type` | Get specific event definition |

## 8D: CLI Tool

### Design

Single-file TypeScript CLI using Node.js built-ins only (no external dependencies like commander/yargs). Executed via `npx tsx bin/payorchestrate.ts`.

### Commands

| Command | Description |
|---------|-------------|
| `login` | Store API key in `~/.payorchestrate/config.json` |
| `payments list` | List recent payments (table format) |
| `payments create --amount <cents> --currency <code>` | Create a payment |
| `payments get <id>` | Get payment details |
| `webhooks listen` | Register temporary webhook, poll for deliveries |
| `logs tail` | Stream recent logs |
| `sandbox test-cards` | Show test card reference |
| `sandbox trigger-dispute --payment <id>` | Trigger dispute in sandbox |

### Config Storage

```json
// ~/.payorchestrate/config.json
{
  "apiKey": "pk_test_...",
  "baseUrl": "http://localhost:3000"
}
```

### Files

- `bin/payorchestrate.ts` — CLI entry point with command routing
- `src/cli/cli-client.ts` — HTTP client for CLI commands
- `src/cli/cli-client.test.ts` — Tests for CLI client logic

## Data Model Changes

### New Event Types (added to PaymentEventType)

| Event Type | Trigger |
|------------|---------|
| `SandboxPaymentSimulated` | Test card used in sandbox mode |
| `SandboxDisputeTriggered` | Manual dispute trigger via sandbox endpoint |

### No New Prisma Models

Phase 8 adds no new database tables. The sandbox service reuses existing models with environment-scoped queries.

## Dashboard Pages

### /sandbox — Sandbox Management

- Test card reference table with card numbers, behaviors, descriptions
- Sandbox data reset button
- Trigger dispute form
- Sandbox vs production indicator

### /webhook-catalog — Event Documentation

- Categorized event list (payment, subscription, dispute, payout, merchant)
- Event detail panel with payload schema and example
- Signature verification guide
- Integration code snippets (Node.js, Python, Ruby)

## Files to Create

| File | Purpose |
|------|---------|
| `src/docs/openapi-spec.ts` | OpenAPI 3.1 spec object |
| `src/docs/docs-routes.ts` | `/docs`, `/redoc`, `/openapi.json` routes |
| `src/sandbox/sandbox-service.ts` | Test card behaviors, sandbox payment simulation |
| `src/sandbox/sandbox-service.test.ts` | Sandbox service tests |
| `src/webhook-catalog/webhook-catalog.ts` | Event definitions, payload builder |
| `src/webhook-catalog/webhook-catalog.test.ts` | Catalog tests |
| `src/cli/cli-client.ts` | CLI HTTP client |
| `src/cli/cli-client.test.ts` | CLI client tests |
| `bin/payorchestrate.ts` | CLI entry point |
| `dashboard/src/app/sandbox/page.tsx` | Sandbox dashboard page |
| `dashboard/src/app/webhook-catalog/page.tsx` | Webhook catalog dashboard page |

## Files to Modify

| File | Changes |
|------|---------|
| `src/core/types.ts` | Add 2 new event types |
| `src/api/payment-service.ts` | Add `getSandboxService()`, `getWebhookCatalog()` |
| `src/api/admin-routes.ts` | Add sandbox + webhook catalog endpoints |
| `src/main.ts` | Mount docs routes, create sandbox service |
| `dashboard/src/lib/api.ts` | Add sandbox + webhook catalog API functions |
| `dashboard/src/app/shell.tsx` | Add Sandbox + Webhook Catalog nav items |
| `package.json` | Add `swagger-ui-express`, `@types/swagger-ui-express`, add `bin` script |

## Testing Plan

| Service | Tests | Key Scenarios |
|---------|-------|---------------|
| `sandbox-service` | ~15 | Test card detection, behavior mapping, all 7 test cards, simulate payment, trigger dispute |
| `webhook-catalog` | ~12 | Event listing, category filtering, payload building, envelope schema, all 22 events |
| `cli-client` | ~10 | Config read/write, HTTP methods, error handling, command parsing |
| **Total** | **~37** | |

## Implementation Order

1. OpenAPI spec + docs routes (8A)
2. Webhook event catalog (8C) — needed by OpenAPI and sandbox
3. Sandbox service (8B)
4. CLI tool (8D)
5. Dashboard pages
6. Wire everything together
7. Tests
8. Type check + test run

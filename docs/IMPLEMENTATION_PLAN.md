# Implementation Plan: Payment Orchestrator v2

## Current State

- 27 backend source files across 10 modules in `src/`
- 49 unit tests across 6 test files
- 10-page Next.js dashboard
- Single `PaymentProvider` stub with chaos-driven failures
- PostgreSQL via Prisma (7 models), Docker Compose deployment

## Feature Priority & Dependency Graph

```
F1: Multi-Provider Routing ──────┐
                                 ├─► F2: Smart Retry / Decline Codes
F3: Fraud Scoring ───────────────┘         │
F4: Tokenization Vault                     │
F5: Multi-Currency + FX ──── depends on F1 │
F6: GraphQL Layer ──── depends on F1-F5    │
F7: OpenTelemetry ──── independent         │
F8: Integration Tests ──── depends on F1-F5│
F9: CI/CD Pipeline ──── depends on F8      │
F10: README Overhaul ──── last             │
```

---

## Feature 1: Multi-Provider Payment Routing

### Problem

Currently `payment-service.ts:107-108` creates a single `PaymentProvider` wired to the `"payment-provider"` chaos key. All payments route to the same stub. There is no provider selection, fallback, or performance tracking.

### New Modules

| File | Purpose |
|------|---------|
| `src/routing/provider-registry.ts` | Registry of PSP providers with metadata (currencies, regions, cost tier) |
| `src/routing/routing-engine.ts` | Selects optimal provider per transaction, cascading fallback |
| `src/routing/provider-metrics.ts` | Tracks per-provider success rate, latency, volume in DB |
| `src/external-services/stripe-provider.ts` | Simulated Stripe PSP |
| `src/external-services/adyen-provider.ts` | Simulated Adyen PSP |
| `src/external-services/paypal-provider.ts` | Simulated PayPal PSP |

### Provider Registry Design

```typescript
interface ProviderConfig {
  name: string;                     // "stripe", "adyen", "paypal"
  supportedCurrencies: string[];    // ["USD", "EUR", "GBP"]
  supportedRegions: string[];       // ["US", "EU", "APAC"]
  costBasisPoints: number;          // 250 = 2.50% fee
  minAmountCents: number;           // Minimum transaction amount
  maxAmountCents: number;           // Maximum transaction amount
  priority: number;                 // Lower = preferred
}

interface ProviderRegistry {
  register(config: ProviderConfig, provider: PaymentProvider): void;
  getProvider(name: string): PaymentProvider | undefined;
  getAllConfigs(): ProviderConfig[];
  getEligible(currency: string, amount: Cents, region: string): ProviderConfig[];
}
```

Each provider gets its own circuit breaker instance (created via the existing `CircuitBreakerRegistry`) and its own chaos controller entry. The chaos config page already supports arbitrary service names, so adding `"stripe"`, `"adyen"`, `"paypal"` is seamless.

### Routing Engine Design

```typescript
interface RoutingDecision {
  providerId: string;
  score: number;
  reasons: string[];        // ["currency_match", "lowest_cost", "healthy_cb"]
  fallbackOrder: string[];  // ordered list of fallback providers
}

interface RoutingEngine {
  selectProvider(params: RoutingParams): Promise<Result<RoutingDecision, RoutingError>>;
  executeWithFallback(params: RoutingParams): Promise<Result<ChargeResult & { providerId: string }, RoutingError>>;
}

interface RoutingParams {
  amount: Cents;
  currency: string;
  region: string;
  customerId: string;
}
```

**Scoring algorithm** (weighted sum, all configurable):
1. **Currency support** (filter, not score) — provider must support the currency
2. **Circuit breaker health** (weight: 40%) — closed=1.0, half-open=0.3, open=0.0
3. **Historical success rate** (weight: 30%) — from `provider_metrics` table, rolling 1h window
4. **Cost tier** (weight: 20%) — normalized inverse of `costBasisPoints`
5. **Region match** (weight: 10%) — bonus for region match

**Fallback**: `executeWithFallback()` tries providers in score-descending order. Each attempt is logged as an event (`ProviderRoutingAttempt`) in the event store. Max 3 attempts across providers.

### Provider Metrics (DB-backed)

New Prisma model:

```prisma
model ProviderMetric {
  id          String   @id @default(uuid())
  provider    String
  outcome     String   // "success", "failure", "timeout"
  latencyMs   Int      @map("latency_ms")
  declineCode String?  @map("decline_code")
  amount      Int
  currency    String
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([provider, createdAt])
  @@index([provider, outcome])
  @@map("provider_metrics")
}
```

`provider-metrics.ts` exposes:
- `record(provider, outcome, latencyMs, declineCode?, amount, currency)` — append-only
- `getSuccessRate(provider, windowMs)` — `COUNT(success) / COUNT(*)` for rolling window
- `getLatencyPercentiles(provider, windowMs)` — p50/p95/p99 from recent records
- `getVolumeByProvider(windowMs)` — transaction count per provider

### Changes to Existing Code

1. **`payment-saga.ts`**: `createChargePaymentStep` currently calls `deps.paymentProvider.charge()` directly. Replace with `deps.routingEngine.executeWithFallback()`. The saga context gains `providerId` and `routingDecision` fields.

2. **`payment-service.ts`**: Instead of creating one `PaymentProvider`, create a `ProviderRegistry` with 3 providers, each with its own CB and chaos entry. Pass the `RoutingEngine` to saga steps instead of a single provider.

3. **`PaymentSagaContext`**: Add `providerId?: string`, `routingAttempts?: number`.

4. **New event types**: `ProviderSelected`, `ProviderFallback`, `ProviderRoutingFailed`. Add to `PaymentEventType` union.

5. **`PaymentRequest`**: Add optional `region?: string` field (defaults to `"US"`).

### Dashboard: Provider Performance Page

New page at `/providers` with:
- **Provider cards**: Name, status (from CB state), supported currencies, cost tier
- **Success rate chart**: Per-provider bar chart (last 1h, 24h)
- **Latency table**: p50/p95/p99 per provider
- **Routing decision log**: Recent routing decisions with score breakdowns
- **Live routing simulation**: Input amount/currency/region → see which provider would be selected

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/providers` | List all providers with config and health |
| `GET` | `/admin/providers/:name/metrics` | Per-provider success rate, latency, volume |
| `POST` | `/admin/providers/:name/config` | Update provider config (cost, currencies) |
| `GET` | `/admin/routing/simulate` | Simulate routing for given params without executing |

### Tests

| File | Scope |
|------|-------|
| `routing/provider-registry.test.ts` | Registration, eligibility filtering |
| `routing/routing-engine.test.ts` | Scoring, fallback cascade, all-providers-down |
| `routing/provider-metrics.test.ts` | Recording, success rate calc, percentiles |

---

## Feature 2: Smart Retry with Decline Code Analysis

### Problem

Currently, payment failures are binary — chaos says fail or succeed. No decline reason codes, no retry intelligence. The saga immediately compensates on any charge failure.

### New Modules

| File | Purpose |
|------|---------|
| `src/retry/decline-codes.ts` | Decline code taxonomy and classification |
| `src/retry/retry-strategy.ts` | Determines retry action based on decline code |
| `src/retry/retry-scheduler.ts` | Schedules deferred retries with backoff |

### Decline Code Taxonomy

```typescript
type DeclineCategory = "hard" | "soft" | "retriable";

interface DeclineCode {
  code: string;                // "insufficient_funds"
  category: DeclineCategory;
  description: string;
  retryable: boolean;
  suggestedAction: "block" | "retry_alternate" | "retry_same" | "retry_later";
  maxRetries: number;          // 0 for hard declines
}
```

**Hard declines** (never retry): `fraud_suspected`, `stolen_card`, `card_blocked`, `invalid_account`
**Soft declines** (retry alternate provider): `processor_unavailable`, `timeout`, `rate_limited`, `do_not_honor`
**Retriable declines** (retry same provider later): `insufficient_funds`, `expired_card`, `temporary_hold`

### How It Integrates

1. **Simulated providers** now return decline codes (not just `Error`). `ChargeResult` becomes:
   ```typescript
   type ChargeOutcome =
     | { ok: true; value: ChargeResult }
     | { ok: false; error: Error; declineCode: string };
   ```

2. **`RetryStrategy`** sits between the routing engine and the saga step:
   ```typescript
   interface RetryStrategy {
     analyze(declineCode: string): RetryAction;
     getSchedule(declineCode: string, attempt: number): RetrySchedule;
   }

   type RetryAction =
     | { action: "fail"; reason: string }          // Hard decline → stop
     | { action: "retry_alternate" }                // Soft → try next provider
     | { action: "retry_later"; delayMs: number };  // Retriable → schedule
   ```

3. **Integration with routing fallback**: When `executeWithFallback` gets a soft decline, it already cascades to the next provider. But when it gets a retriable decline, it needs to schedule a deferred retry.

4. **Deferred retries**: New Prisma model `PaymentRetry` tracks scheduled retries. The existing webhook scheduler pattern is reused — a `RetryScheduler` runs on a 10s interval processing due retries.

### New Prisma Model

```prisma
model PaymentRetry {
  id            String   @id @default(uuid())
  paymentId     String   @map("payment_id")
  provider      String
  declineCode   String   @map("decline_code")
  attempt       Int
  maxAttempts   Int      @map("max_attempts")
  status        String   @default("pending") // pending, retrying, succeeded, exhausted
  scheduledAt   DateTime @map("scheduled_at")
  processedAt   DateTime? @map("processed_at")
  createdAt     DateTime @default(now()) @map("created_at")

  @@index([status, scheduledAt])
  @@index([paymentId])
  @@map("payment_retries")
}
```

### New Event Types

`PaymentDeclined`, `RetryScheduled`, `RetryAttempted`, `RetryExhausted`. Added to `PaymentEventType`.

### Dashboard: Retry Waterfall

On the payment detail page (`/payments/:id`), add a new section:
- **Retry timeline**: Visual waterfall showing each attempt → provider → outcome → delay → next attempt
- **Decline code badge**: Shows code + category (color-coded: red=hard, orange=soft, yellow=retriable)
- **Retry schedule**: If retry is pending, show countdown to next attempt

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/decline-codes` | List all decline codes with categories |
| `GET` | `/payments/:id/retries` | Retry history for a payment |

### Tests

| File | Scope |
|------|-------|
| `retry/decline-codes.test.ts` | Classification correctness for all codes |
| `retry/retry-strategy.test.ts` | Action selection per category, backoff schedule |

---

## Feature 3: Rule-Based Fraud Scoring Engine

### Problem

No fraud prevention. Any payment request proceeds to the saga regardless of risk signals.

### New Modules

| File | Purpose |
|------|---------|
| `src/fraud/fraud-engine.ts` | Evaluates payment against rules, returns score |
| `src/fraud/fraud-rules.ts` | Rule definitions and default rule set |
| `src/fraud/velocity-tracker.ts` | Tracks recent payment velocity per customer |

### Fraud Engine Design

```typescript
interface FraudRule {
  id: string;
  name: string;
  description: string;
  type: "velocity" | "amount_anomaly" | "geo_mismatch" | "custom";
  config: Record<string, unknown>;  // Rule-specific params
  weight: number;                    // 0-100
  enabled: boolean;
}

type FraudAction = "allow" | "review" | "block";

interface FraudResult {
  score: number;                  // 0-100
  action: FraudAction;            // Derived from score thresholds
  ruleResults: RuleResult[];      // Per-rule breakdown
  evaluatedAt: string;
}

interface FraudEngine {
  evaluate(payment: PaymentRequest, context: FraudContext): Promise<Result<FraudResult, FraudError>>;
  getRules(): Promise<FraudRule[]>;
  upsertRule(rule: FraudRule): Promise<Result<FraudRule, FraudError>>;
  deleteRule(ruleId: string): Promise<Result<void, FraudError>>;
}
```

**Score thresholds** (configurable): 0-30 = ALLOW, 31-70 = REVIEW, 71-100 = BLOCK.

### Default Rules

1. **Velocity check**: >5 payments from same `customerId` in 10 minutes → weight 30
2. **Amount anomaly**: Amount > 3x customer's average (from event store history) → weight 25
3. **High value**: Amount > 100000 cents ($1000) → weight 15
4. **Geographic mismatch**: `region` doesn't match customer's usual region → weight 20
5. **New customer**: First payment from this `customerId` → weight 10

### Integration with Payment Flow

Fraud evaluation runs **before** the saga starts, inside `paymentService.initiatePayment()`:

```
validateRequest() → fraudEngine.evaluate() → [if BLOCK: return err] → [if REVIEW: flag] → saga.execute()
```

- BLOCK: Payment rejected immediately with `FraudBlocked` event
- REVIEW: Payment proceeds but flagged with `FraudReview` event (visible in dashboard)
- ALLOW: Normal flow, `FraudCleared` event

### New Prisma Model

```prisma
model FraudRule {
  id          String   @id @default(uuid())
  name        String
  description String
  ruleType    String   @map("rule_type")
  config      Json     @default("{}")
  weight      Int      @default(10)
  enabled     Boolean  @default(true)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@map("fraud_rules")
}

model FraudEvaluation {
  id          String   @id @default(uuid())
  paymentId   String   @map("payment_id")
  score       Int
  action      String   // allow, review, block
  ruleResults Json     @map("rule_results")
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([paymentId])
  @@index([action])
  @@map("fraud_evaluations")
}
```

### New Event Types

`FraudCleared`, `FraudReview`, `FraudBlocked`. Added to `PaymentEventType`.

### Dashboard: Fraud Rules Page

New page at `/fraud`:
- **Rule list**: All rules with name, type, weight, enabled toggle
- **Rule editor**: Modal/inline form to create/edit rules (type selector, config fields, weight slider)
- **Recent evaluations**: Table of recent fraud checks with score, action, payment link

On payment detail page:
- **Fraud score card**: Score gauge (0-100), action badge, per-rule breakdown showing which rules triggered and their individual contributions

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/fraud/rules` | List all fraud rules |
| `POST` | `/admin/fraud/rules` | Create a fraud rule |
| `PUT` | `/admin/fraud/rules/:id` | Update a fraud rule |
| `DELETE` | `/admin/fraud/rules/:id` | Delete a fraud rule |
| `GET` | `/payments/:id/fraud` | Fraud evaluation for a payment |
| `POST` | `/admin/fraud/simulate` | Simulate scoring without creating payment |

### Tests

| File | Scope |
|------|-------|
| `fraud/fraud-engine.test.ts` | Score calculation, threshold actions, rule weighting |
| `fraud/velocity-tracker.test.ts` | Count tracking, window expiry |
| `fraud/fraud-rules.test.ts` | Each default rule evaluates correctly |

---

## Feature 4: Tokenization Vault

### Problem

No card data handling. The current system takes amount/currency/customer but never touches card details. Adding a simulated tokenization vault demonstrates PCI-DSS awareness.

### New Modules

| File | Purpose |
|------|---------|
| `src/tokenization/token-vault.ts` | Token CRUD, encryption simulation, lifecycle |
| `src/tokenization/card-masker.ts` | Mask/redact card numbers in logs and events |

### Token Vault Design

```typescript
interface TokenizedCard {
  token: string;              // "tok_xxxx"
  last4: string;              // "4242"
  brand: string;              // "visa", "mastercard"
  expiryMonth: number;
  expiryYear: number;
  customerId: string;
  createdAt: string;
  usageCount: number;
  status: "active" | "expired" | "revoked";
}

interface TokenVault {
  tokenize(card: CardDetails): Promise<Result<TokenizedCard, TokenError>>;
  getToken(token: string): Promise<Result<TokenizedCard, TokenError>>;
  useToken(token: string): Promise<Result<TokenizedCard, TokenError>>;  // Increments usage
  revokeToken(token: string): Promise<Result<void, TokenError>>;
  listByCustomer(customerId: string): Promise<Result<TokenizedCard[], TokenError>>;
  expireStale(): Promise<Result<number, TokenError>>;  // Expire tokens past expiryYear/Month
}
```

**Key invariant**: The raw card number (`pan`) is never stored in events, logs, or the `event_store` table. Only the token, last4, and brand are persisted. The `card-masker.ts` utility is used at the API boundary to strip PAN before any logging.

### New Prisma Model

```prisma
model PaymentToken {
  id          String   @id @default(uuid())
  token       String   @unique
  customerId  String   @map("customer_id")
  last4       String
  brand       String
  expiryMonth Int      @map("expiry_month")
  expiryYear  Int      @map("expiry_year")
  encryptedPan String  @map("encrypted_pan")  // Simulated encryption
  status      String   @default("active")     // active, expired, revoked
  usageCount  Int      @default(0) @map("usage_count")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@index([customerId])
  @@index([status])
  @@map("payment_tokens")
}
```

### Integration

1. **`PaymentRequest`** gains optional `card?: { pan: string; expiryMonth: number; expiryYear: number; brand: string }` and `token?: string` fields. One or the other must be present (validation in `payment-service.ts`).
2. If `card` is provided, tokenize it first, store the token, then pass only the token through the saga.
3. If `token` is provided, look it up, increment usage, verify it's active and not expired.
4. **Event payloads**: The `PaymentInitiated` event payload stores `tokenId` and `last4`, never the PAN.
5. **Logger guard**: `card-masker.ts` provides a `sanitizePayload()` function that replaces any key matching `/pan|card_number|cardNumber/i` with `"[REDACTED]"`. Applied in the request logger middleware.

### Dashboard: Tokens Page

New page at `/tokens`:
- **Token list**: Table with token (truncated), last4, brand, customer, status badge, usage count, expiry
- **Token actions**: Revoke button per token
- **Lifecycle view**: Show token state transitions (created → used N times → expired/revoked)

On payment detail page:
- **Token badge**: Shows "Tokenized: •••• 4242 (Visa)" instead of raw card data

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/tokens` | List tokens (paginated, filterable by customer) |
| `GET` | `/tokens/:token` | Token details |
| `POST` | `/tokens/revoke/:token` | Revoke a token |

### Tests

| File | Scope |
|------|-------|
| `tokenization/token-vault.test.ts` | Tokenize, retrieve, use, revoke, expiry |
| `tokenization/card-masker.test.ts` | PAN redaction in various payload shapes |

---

## Feature 5: Multi-Currency Support with FX Simulation

### Problem

Currency is stored but never validated or converted. All providers accept any currency. No FX rates.

### New Modules

| File | Purpose |
|------|---------|
| `src/fx/fx-service.ts` | FX rate lookup, conversion, spread calculation |
| `src/fx/fx-rates.ts` | Rate storage and configurable rate table |

### FX Service Design

```typescript
interface FxRate {
  fromCurrency: string;
  toCurrency: string;
  rate: number;           // 1 USD = rate of toCurrency
  spread: number;         // Markup in basis points (e.g., 50 = 0.50%)
  updatedAt: string;
}

interface FxConversion {
  originalAmount: Cents;
  originalCurrency: string;
  convertedAmount: Cents;
  settlementCurrency: string;
  rate: number;
  spread: number;
  fxMarginCents: Cents;   // How much the spread costs
}

interface FxService {
  getRate(from: string, to: string): Promise<Result<FxRate, FxError>>;
  convert(amount: Cents, from: string, to: string): Promise<Result<FxConversion, FxError>>;
  getAllRates(): Promise<Result<FxRate[], FxError>>;
  setRate(from: string, to: string, rate: number, spread: number): void;
}
```

### Default Rates

Hardcoded initial rates (configurable at runtime via admin API):

| Pair | Rate | Spread |
|------|------|--------|
| USD/EUR | 0.92 | 50bp |
| USD/GBP | 0.79 | 60bp |
| USD/JOD | 0.71 | 80bp |
| EUR/USD | 1.09 | 50bp |
| GBP/USD | 1.27 | 60bp |

### Integration

1. **Provider configs** now specify a `settlementCurrency` (e.g., Stripe settles in USD, Adyen in EUR).
2. **Routing engine** considers whether FX conversion is needed. If the payment currency matches the provider's settlement currency, no conversion (lower cost).
3. When conversion is needed, `FxService.convert()` is called before the charge. The conversion details are stored in the saga context and as a `CurrencyConverted` event.
4. **`PaymentSagaContext`** gains `fxConversion?: FxConversion`.
5. **New event types**: `CurrencyConverted`.

### Dashboard Updates

On payment detail page:
- **FX card** (if conversion occurred): Original amount → converted amount, rate applied, spread, margin cost

New section on Provider Performance page:
- **Currency coverage matrix**: Which providers support which currencies (grid)

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/fx/rates` | All current FX rates |
| `POST` | `/admin/fx/rates` | Update an FX rate pair |

### Tests

| File | Scope |
|------|-------|
| `fx/fx-service.test.ts` | Conversion math, spread application, missing pair handling |

---

## Feature 6: GraphQL API Layer

### Problem

REST-only API limits how the dashboard can query data. No real-time updates without polling.

### Approach

Add GraphQL alongside REST using `graphql-yoga` (lightweight, works with Express). This avoids replacing the existing REST API and shows API design maturity.

### New Modules

| File | Purpose |
|------|---------|
| `src/graphql/schema.ts` | Type definitions |
| `src/graphql/resolvers.ts` | Query, Mutation, Subscription resolvers |
| `src/graphql/subscriptions.ts` | PubSub for real-time payment events |

### Schema (Key Types)

```graphql
type Query {
  payment(id: ID!): Payment
  payments(first: Int, after: String, status: PaymentStatus): PaymentConnection
  paymentEvents(paymentId: ID!): [DomainEvent!]!
  providers: [Provider!]!
  fraudRules: [FraudRule!]!
  metrics: MetricsSnapshot!
}

type Mutation {
  createPayment(input: CreatePaymentInput!): Payment!
  registerWebhook(url: String!, events: [String!]!): WebhookRegistration!
  upsertFraudRule(input: FraudRuleInput!): FraudRule!
  updateChaos(service: String!, config: ChaosInput!): ServiceChaosConfig!
  revokeToken(token: String!): Boolean!
}

type Subscription {
  paymentStatusChanged(paymentId: ID): PaymentStatusEvent!
  providerHealthChanged: ProviderHealthEvent!
}

type PaymentConnection {
  edges: [PaymentEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}
```

### Integration

1. Add `graphql-yoga` and `graphql` to dependencies.
2. Mount GraphQL handler at `/graphql` in `main.ts`, alongside existing REST routes.
3. Resolvers delegate to the existing `PaymentService`, `FraudEngine`, `RoutingEngine`, etc. No duplicate business logic.
4. `PubSub` emitter is called from `payment-service.ts` when payment status changes. The subscription resolver listens.
5. Dashboard can optionally switch to GraphQL for certain pages, but REST remains fully functional.

### Dashboard: GraphQL Playground

Add a link to `/graphql` (Yoga's built-in GraphiQL). No custom page needed.

### Tests

| File | Scope |
|------|-------|
| `graphql/resolvers.test.ts` | Query/mutation resolver logic with mocked services |

---

## Feature 7: OpenTelemetry Distributed Tracing

### Problem

Current logging is structured JSON to stdout with an in-memory buffer. No trace propagation, no span hierarchy, no visual trace waterfall.

### Approach

Add `@opentelemetry/sdk-node` with the OTLP exporter. In Docker, add a Jaeger container. Keep the existing structured logger as a secondary output.

### New Modules

| File | Purpose |
|------|---------|
| `src/observability/tracing.ts` | OTel SDK initialization, tracer factory |
| `src/observability/span-helpers.ts` | Convenience wrappers for saga step spans |

### Integration

1. **`tracing.ts`** initializes the OTel SDK at the top of `main.ts` (before anything else).
2. **Express middleware**: OTel HTTP instrumentation auto-creates spans for each request.
3. **Saga steps**: Each step's `execute()` and `compensate()` are wrapped in child spans. The span records the step name, provider used, outcome, and duration.
4. **Routing engine**: Spans for provider selection and each fallback attempt.
5. **Event store**: Spans for append and query operations.
6. **Export**: OTLP gRPC to Jaeger (in Docker). Fallback to console exporter in dev.

### Docker Compose Addition

```yaml
jaeger:
  image: jaegertracing/all-in-one:1.54
  ports:
    - "16686:16686"   # Jaeger UI
    - "4317:4317"     # OTLP gRPC
  environment:
    COLLECTOR_OTLP_ENABLED: "true"
```

### Dashboard: Trace Waterfall

On payment detail page, add a "Trace" tab:
- Fetch trace from Jaeger API by payment ID (stored as span tag)
- Render a waterfall visualization showing span hierarchy and timing
- Alternative: If Jaeger is not available, link to Jaeger UI with pre-filled trace ID

### New Dependencies

- `@opentelemetry/sdk-node`
- `@opentelemetry/auto-instrumentations-node`
- `@opentelemetry/exporter-trace-otlp-grpc`

### Tests

Tracing is infrastructure — tested indirectly via integration tests. A unit test can verify that the tracer factory returns valid spans without exporting.

---

## Feature 8: Comprehensive Integration Tests

### Problem

49 unit tests with mocked boundaries. No tests exercise the real DB, full saga flow, or resilience under chaos.

### New Test Files

| File | Scope |
|------|-------|
| `tests/integration/payment-flow.test.ts` | Full payment saga with DB |
| `tests/integration/routing-fallback.test.ts` | Multi-provider cascade with DB |
| `tests/integration/chaos-compensation.test.ts` | Chaos injection → compensation verified |
| `tests/integration/fraud-blocking.test.ts` | Fraud rules → payment blocked |
| `tests/integration/tokenization.test.ts` | Token lifecycle through payment flow |
| `tests/integration/idempotency.test.ts` | Duplicate request deduplication with DB |
| `tests/integration/setup.ts` | DB setup/teardown using test containers or test schema |
| `tests/load/k6-payment-flow.js` | k6 load test script |
| `tests/load/README.md` | How to run, expected results |

### Integration Test Strategy

- Use a **separate Prisma schema** pointing to a test database (Docker PostgreSQL).
- `setup.ts` runs `prisma migrate deploy` against the test DB before each suite and truncates tables between tests.
- Tests call the actual Express routes via `supertest` (or direct `PaymentService` calls with real Prisma).
- Chaos controller is used to simulate specific failure scenarios deterministically (set `failureRate: 1.0` for targeted services).

### Load Test (k6)

Script creates 100 VUs ramping over 60 seconds:
- Mixed payment amounts and currencies
- 10% failure rate on payment provider (via chaos API)
- Assertions: p95 < 500ms, error rate < 15%, no 500s

### Coverage Target

- Add `c8` for coverage collection.
- Target: 80%+ line coverage across `src/`.
- Vitest config: `coverage: { provider: "v8", include: ["src/**/*.ts"], exclude: ["**/*.test.ts"] }`.

---

## Feature 9: CI/CD Pipeline

### New Files

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Main CI pipeline |
| `.github/workflows/docker.yml` | Docker build verification |

### CI Pipeline (`ci.yml`)

```yaml
name: CI
on: [push, pull_request]

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - Checkout
      - Node 20 setup
      - npm ci
      - npx tsc --noEmit
      - npm run lint
      - cd dashboard && npm ci && npx tsc --noEmit

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - Checkout
      - Node 20 setup
      - npm ci && npx prisma generate
      - npm test -- --reporter=verbose --coverage

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: test_user
          POSTGRES_PASSWORD: test_pass
          POSTGRES_DB: test_payment_orchestrator
        ports: [5432:5432]
        options: --health-cmd pg_isready
    steps:
      - Checkout
      - Node 20 setup
      - npm ci && npx prisma generate
      - DATABASE_URL=... npx prisma migrate deploy
      - DATABASE_URL=... npm run test:integration

  docker-build:
    runs-on: ubuntu-latest
    steps:
      - Checkout
      - docker build -t payment-orchestrator:test .
```

### README Badge

```markdown
[![CI](https://github.com/JamilAfouri99/payment-orchestrator/actions/workflows/ci.yml/badge.svg)](...)
[![Coverage](https://img.shields.io/badge/coverage-80%25-green)](...)
```

---

## Feature 10: README Overhaul

### Structure

1. **One-liner + badge row** (CI, coverage, license)
2. **30-second summary** with "Why this exists" for recruiters
3. **Screenshot grid** (existing, reorganized)
4. **Quick Start** (unchanged)
5. **Architecture diagram** (updated Mermaid with new components)
6. **Engineering Decisions** — for each pattern, 2-3 sentences on WHY:
   - Why sagas over 2PC
   - Why event sourcing over CRUD
   - Why in-process circuit breakers over service mesh
   - Why multi-provider routing with scoring
   - Why fraud scoring runs pre-saga
   - Why tokenization vault instead of direct PCI handling
7. **Performance** — numbers from k6 load test (p50, p95, p99, throughput)
8. **What I'd Do Differently in Production** — honest self-assessment:
   - Use Kafka/NATS for event streaming instead of polling
   - Use a real vault (HashiCorp Vault) instead of DB encryption
   - Use Temporal or Cadence instead of hand-rolled saga orchestrator
   - Use Redis for idempotency instead of PostgreSQL
   - Add rate limiting at the API gateway level
   - Separate read/write models (full CQRS)
9. **API Reference** (existing, expanded with new endpoints)
10. **Running Tests** (expanded with integration + load test commands)

---

## Implementation Order & Estimated Scope

| # | Feature | New Files | New Tests | New DB Models | Dashboard Pages |
|---|---------|-----------|-----------|---------------|-----------------|
| 1 | Multi-Provider Routing | 6 | 3 files (~20 tests) | 1 (ProviderMetric) | 1 (/providers) |
| 2 | Smart Retry | 3 | 2 files (~12 tests) | 1 (PaymentRetry) | Detail page update |
| 3 | Fraud Scoring | 3 | 3 files (~15 tests) | 2 (FraudRule, FraudEvaluation) | 1 (/fraud) + detail update |
| 4 | Tokenization Vault | 2 | 2 files (~10 tests) | 1 (PaymentToken) | 1 (/tokens) + detail update |
| 5 | Multi-Currency FX | 2 | 1 file (~8 tests) | 0 (in-memory rates) | Detail page update |
| 6 | GraphQL Layer | 3 | 1 file (~8 tests) | 0 | Link to GraphiQL |
| 7 | OpenTelemetry | 2 | 0 (infra) | 0 | Detail page trace tab |
| 8 | Integration Tests | 8 | 6 files (~40 tests) | 0 | None |
| 9 | CI/CD | 2 | 0 | 0 | None |
| 10 | README Overhaul | 1 | 0 | 0 | None |
| **Total** | | **~32 files** | **~18 test files (~113 tests)** | **5 new models** | **3 new pages** |

### Migration Strategy

Each feature adds new Prisma models via new migration files. Features are additive — no existing table modifications except adding columns to `PaymentRequest` type (not a DB model) and new `PaymentEventType` union members. Existing tests continue to pass unchanged.

### Branching Strategy

One feature branch per feature: `feature/multi-provider-routing`, `feature/smart-retry`, etc. Each branch includes its tests, dashboard updates, and migration. Merge to main after tests pass.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| GraphQL adds complexity | Use graphql-yoga (minimal setup), resolvers delegate to existing services |
| OTel SDK weight | Tree-shakeable, only OTLP exporter in production Docker image |
| Integration tests slow | Parallelize per-file, truncate tables (not recreate), test-specific DB |
| Prisma migration conflicts | Each feature's migration is timestamped independently |
| Dashboard page count grows | Add navigation grouping (Payments, Resilience, Security, Observability) |

# Payment Orchestrator

## What This Is

A production-grade payment processing system demonstrating distributed systems patterns: multi-provider routing with weighted scoring, saga orchestration with compensation, event sourcing with temporal queries, circuit breakers, bulkheads, fraud scoring, tokenization, multi-currency FX, GraphQL subscriptions, OpenTelemetry tracing, and chaos engineering. Express API + PostgreSQL backend, Next.js dashboard frontend. All amounts in **cents** (integer `Cents` type).

## Quick Reference

```bash
# Backend (from project root)
npm test                           # 207 Vitest unit tests (15 files)
npx tsc --noEmit                   # Type check backend

# Dashboard (from dashboard/)
cd dashboard && npx tsc --noEmit   # Type check frontend

# Docker (API + PostgreSQL + Jaeger)
docker-compose up --build -d       # API :3000, Dashboard :3001, Jaeger :16686
docker-compose down -v             # Tear down with volume cleanup

# Database
npx prisma migrate dev             # Dev migration
npx prisma migrate deploy          # Production migration
npx prisma generate                # Regenerate client after schema change
```

## Architecture

### Dependency Flow

```
main.ts (entry point)
├── core/*                 config, logger, correlation, database, result
├── chaos-controller       5 services: stripe, adyen, paypal, inventory, notification
├── metrics-collector      in-memory counters + histograms
├── payment-service        (aggregates all domain logic)
│   ├── event-store + snapshot-store + payment-projection
│   ├── saga-orchestrator + payment-saga (4 steps)
│   ├── circuit-breaker-registry (5 breakers: 3 PSP + 2 service)
│   ├── bulkhead x3 (payment-providers, inventory, notification)
│   ├── provider-registry (Stripe, Adyen, PayPal)
│   ├── provider-metrics (DB-backed per-provider stats)
│   ├── routing-engine (weighted scoring + cascading fallback)
│   ├── retry-strategy + decline-codes
│   ├── fraud-engine (rule-based, DB-stored)
│   ├── token-vault (PCI-compliant tokenization)
│   ├── fx-service (multi-currency conversion)
│   ├── webhook-delivery + idempotency-middleware
│   ├── inventory-service, notification-service
│   └── stripe-provider, adyen-provider, paypal-provider
├── routes                 public REST endpoints
├── admin-routes           admin REST endpoints (40+ routes)
├── graphql                yoga server (queries, mutations, subscriptions)
├── webhook-scheduler      5s interval retry processor
├── saga-recovery          startup scan for incomplete sagas
└── fraud seed-rules       5 default fraud rules on first boot
```

### Express Middleware Stack (order matters)

1. `express.json()`
2. `correlationMiddleware` — sets `X-Request-ID`
3. `requestLoggerMiddleware` — logs every request with timing
4. `routes` — public endpoints
5. `adminRoutes` — admin endpoints
6. `graphql` — mounted at `/graphql`
7. `errorHandler` — RFC 7807 Problem Details (catch-all, must be last)

### Payment Flow

```
POST /payments (with Idempotency-Key header)
  → validateRequest()
  → tokenVault.tokenize() or tokenVault.useToken()
  → fraudEngine.evaluate()
      → BLOCK: return 403, emit FraudBlocked event, stop
      → REVIEW: flag, emit FraudReview event, continue
      → ALLOW: emit FraudCleared event, continue
  → routingEngine.selectProvider() for FX check
  → fxService.convert() if currency mismatch
  → eventStore.append(PaymentInitiated)
  → sagaOrchestrator.execute()
      Step 1: validate (item total check)
      Step 2: reserve_inventory (via inventoryCb → inventoryService)
      Step 3: charge_payment (via routingEngine.executeWithFallback)
              → scores providers → tries best → falls back on failure
              → records provider metrics per attempt
      Step 4: notify (via notificationCb → notificationService)
              → failure is non-critical, payment still completes
  → webhookService.dispatch() on completion/failure
  → snapshotStore.save() if event count >= SNAPSHOT_THRESHOLD
```

## Patterns

| Pattern | Module | Key Details |
|---------|--------|-------------|
| **Multi-Provider Routing** | `src/routing/` | 3 PSPs (Stripe/Adyen/PayPal), weighted scoring: CB health 40%, success rate 30%, cost 20%, region 10%. Max 3 fallback attempts. |
| **Decline Code Analysis** | `src/retry/` | 13 codes in 3 categories: hard (never retry), soft (alternate provider), retriable (same provider later). |
| **Fraud Scoring** | `src/fraud/` | 5 default rules (velocity, amount anomaly, high value, geo mismatch, new customer). Score thresholds: ≤30 ALLOW, ≤70 REVIEW, >70 BLOCK. |
| **Tokenization Vault** | `src/tokenization/` | `tok_` prefixed tokens, PAN never in events/logs. `card-masker.ts` redacts sensitive keys recursively. |
| **Multi-Currency FX** | `src/fx/` | 8 default rate pairs (USD/EUR/GBP/JOD). Spread in basis points. Settlement currency per provider affects routing. |
| **Saga Orchestration** | `src/saga/` | 4-step flow with reverse-order compensation. State persisted to DB at each step. |
| **Event Sourcing** | `src/events/` | 28 event types. Optimistic locking via unique `(aggregateId, version)`. State derived by reducer replay. |
| **Temporal Queries** | `event-store.ts` | `getByAggregateIdAt()` replays events up to a timestamp. |
| **Snapshots** | `snapshot-store.ts` | `SNAPSHOT_THRESHOLD = 10` events before snapshotting. |
| **Circuit Breaker** | `src/circuit-breaker/` | 5 breakers (3 PSP + 2 service). Exponential backoff: `baseMs * 2^min(attempt-1, 5)` + 10% jitter. |
| **Bulkhead** | `src/bulkhead/` | payment-providers (10/20), inventory (15/30), notification (20/40). |
| **Chaos Engineering** | `src/chaos/` | Runtime failure rate + latency per service. 5 services configured. |
| **Idempotency** | `src/idempotency/` | `Idempotency-Key` header, cached responses, 24h TTL. |
| **Webhooks** | `src/webhooks/` | HMAC-SHA256, 3 retries with backoff, then DLQ. 5s scheduler. |
| **GraphQL** | `src/graphql/` | `graphql-yoga`. Queries, mutations, subscriptions via in-process PubSub. |
| **OpenTelemetry** | `src/observability/` | OTLP exporter to Jaeger. `withSpan()` helper for custom spans. |
| **Result\<T, E\>** | `src/core/result.ts` | Discriminated union. Business logic never throws. `unwrap()` only at HTTP boundaries. |
| **RFC 7807** | `src/middleware/` | All error responses are Problem Details. |
| **Correlation IDs** | `src/core/correlation.ts` | `X-Request-ID` header propagated through every request. |

## Code Conventions

### TypeScript

- **Target**: ES2022, **Module**: ESNext, **Module resolution**: bundler
- **Strict mode** with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`
- **ESM only** (`"type": "module"` in package.json)
- Relative imports with `.js` extension: `import { ok } from "../core/result.js"`
- `type` keyword for type-only imports: `import type { Request } from "express"`
- Named exports only. No barrel/index files.
- Optional properties require `?: T | undefined` (enforced by `exactOptionalPropertyTypes`)
- Array access requires `!` assertion due to `noUncheckedIndexedAccess`

### Factory Pattern (No Classes)

Every module exports a `createX(deps)` factory function returning a typed interface:

```typescript
export interface EventStore { /* methods */ }
export function createEventStore(prisma: PrismaClient): EventStore { ... }
```

Exception: Error classes use `class extends Error` with a `code` property for type discrimination.

No `new` keyword for business logic. No class inheritance.

### Error Handling

Custom error classes with typed `code` fields:

| Error Class | Codes | HTTP Mapping |
|-------------|-------|-------------|
| `PaymentServiceError` | `VALIDATION`, `SAGA_FAILED`, `NOT_FOUND`, `INTERNAL`, `FRAUD_BLOCKED` | 400, 422, 404, 500, 403 |
| `EventStoreError` | `OPTIMISTIC_LOCK`, `STORE_FAILURE` | — |
| `SagaError` | `STEP_FAILED`, `COMPENSATION_FAILED`, `PERSISTENCE_FAILED` | — |
| `CircuitBreakerError` | state: `open` | — |
| `BulkheadError` | (message only) | — |
| `WebhookError` | `DELIVERY_FAILED`, `REGISTRATION_FAILED`, `DLQ_FAILED` | — |
| `RoutingError` | `NO_ELIGIBLE_PROVIDER`, `ALL_PROVIDERS_FAILED`, `ROUTING_FAILURE` | — |
| `ProviderError` | declineCode string | — |
| `FraudError` | `EVALUATION_FAILED`, `RULE_NOT_FOUND`, `PERSISTENCE_FAILED` | — |
| `TokenError` | `NOT_FOUND`, `EXPIRED`, `REVOKED`, `VAULT_FAILURE` | — |
| `FxError` | `PAIR_NOT_FOUND`, `CONVERSION_FAILED` | — |

Prisma error code `P2002` = optimistic lock conflict (event store version uniqueness).

### Naming

- Files: `kebab-case.ts`
- Factories: `createXxx()`
- Interfaces: `PascalCase` (`EventStore`, `CircuitBreaker`, `RoutingEngine`)
- Error classes: `XxxError` (`PaymentServiceError`, `RoutingError`)
- Constants: `UPPER_SNAKE_CASE` (`SNAPSHOT_THRESHOLD`, `MAX_ATTEMPTS`, `SERVICE_NAME`, `METRICS_WINDOW_MS`)
- Event types: `PascalCase` strings (`PaymentInitiated`, `ProviderSelected`, `FraudBlocked`)
- Service names: `kebab-case` strings (`"stripe"`, `"inventory-service"`)

## File Structure

```
src/
  core/               result.ts, types.ts, config.ts, database.ts, logger.ts, correlation.ts
  events/             event-store.ts, snapshot-store.ts, payment-projection.ts
  saga/               saga-orchestrator.ts, payment-saga.ts, saga-recovery.ts
  routing/            provider-registry.ts, routing-engine.ts, provider-metrics.ts
  retry/              decline-codes.ts, retry-strategy.ts
  fraud/              fraud-engine.ts, seed-rules.ts
  tokenization/       token-vault.ts, card-masker.ts
  fx/                 fx-service.ts
  circuit-breaker/    circuit-breaker.ts, circuit-breaker-registry.ts
  bulkhead/           bulkhead.ts
  chaos/              chaos-controller.ts
  metrics/            metrics-collector.ts
  idempotency/        idempotency-middleware.ts
  webhooks/           webhook-delivery.ts, webhook-scheduler.ts
  external-services/  stripe-provider.ts, adyen-provider.ts, paypal-provider.ts,
                      payment-provider.ts, inventory-service.ts, notification-service.ts
  graphql/            schema.ts, resolvers.ts, subscriptions.ts, yoga-server.ts
  observability/      tracing.ts, span-helpers.ts
  api/                payment-service.ts, routes.ts, admin-routes.ts
  middleware/         error-handler.ts, request-logger.ts
  main.ts             Entry point

dashboard/
  src/app/            13 pages (Next.js App Router, all "use client")
  src/components/     4 shared components
  src/lib/api.ts      API client with 35+ fetch functions and 20+ interfaces
  next.config.ts      Rewrites /api/* to localhost:3000/*

prisma/               Schema (12 models) and 3 migrations
.github/workflows/    ci.yml (lint, typecheck, test, Docker build)
docs/                 Architecture diagrams, ADRs, implementation plan, screenshots
```

## Database (Prisma + PostgreSQL)

Schema in `prisma/schema.prisma`. **12 models**:

| Model | Table | Purpose | Key Constraints |
|-------|-------|---------|-----------------|
| `SagaExecution` | saga_executions | Saga state for crash recovery | Index on aggregateId, status |
| `EventStore` | event_store | Append-only domain events | **Unique (aggregateId, version)** for optimistic locking |
| `EventSnapshot` | event_snapshots | Snapshot optimization | Unique aggregateId (upsert) |
| `IdempotencyKey` | idempotency_keys | Cached responses | Unique key |
| `WebhookDelivery` | webhook_deliveries | Delivery tracking + retry | Index on status, nextRetryAt |
| `WebhookRegistration` | webhook_registrations | Callback URL registrations | — |
| `DeadLetterQueue` | dead_letter_queue | Failed webhooks | Index on sourceType |
| `ProviderMetric` | provider_metrics | Per-provider performance | Index on (provider, createdAt), (provider, outcome) |
| `PaymentRetry` | payment_retries | Scheduled retry tracking | Index on (status, scheduledAt), paymentId |
| `FraudRule` | fraud_rules | Configurable fraud rules | — |
| `FraudEvaluation` | fraud_evaluations | Per-payment fraud results | Index on paymentId, action |
| `PaymentToken` | payment_tokens | Tokenized card instruments | Unique token; index on customerId, status |

## Testing

- **Framework**: Vitest with globals, Node environment, 10s timeout
- **207 tests** across **15 test files** in `src/`
- Test files live next to source: `routing-engine.test.ts` beside `routing-engine.ts`

| Test File | Module | Tests |
|-----------|--------|-------|
| `saga-orchestrator.test.ts` | Saga execution, compensation, persistence | 7 |
| `circuit-breaker.test.ts` | State transitions, backoff calculation | 11 |
| `webhook-delivery.test.ts` | Registration, delivery, HMAC, DLQ | 11 |
| `chaos-controller.test.ts` | Failure rates, config updates, shouldFail | 9 |
| `bulkhead.test.ts` | Concurrency limits, queueing, rejection | 5 |
| `metrics-collector.test.ts` | Counters, histograms, percentiles | 6 |
| `provider-registry.test.ts` | Registration, eligibility filtering | 16 |
| `routing-engine.test.ts` | Scoring, fallback, all-fail error | 15 |
| `provider-metrics.test.ts` | Recording, success rate, percentiles | 13 |
| `decline-codes.test.ts` | Classification, all codes, defaults | 26 |
| `retry-strategy.test.ts` | Action selection, backoff, shouldRetry | 19 |
| `fraud-engine.test.ts` | Rule evaluation, scoring, thresholds | 16 |
| `token-vault.test.ts` | Tokenize, use, revoke, list | 15 |
| `card-masker.test.ts` | PAN redaction, nested objects, maskPan | 21 |
| `fx-service.test.ts` | Conversion math, spread, missing pairs | 17 |

### Mock Strategy

- **Pure logic modules** (fraud, retry, decline-codes, fx, card-masker): No mocks — test real logic directly
- **DB-dependent modules**: Custom `createMockPrisma()` factory with in-memory state via `vi.fn()` + `mockImplementation`
- **External boundaries**: Global `fetch` mocked with `vi.spyOn` (webhooks); mock adapters for routing engine
- **State machines** (circuit-breaker, bulkhead, chaos): Real logic, mock the wrapped async work

## Dashboard (Next.js)

- **Next.js 16** with App Router, React 19, Tailwind CSS v4
- **All 13 pages** are client components (`"use client"`)
- **Dark theme** with CSS custom properties in `globals.css`:
  - `--background: #0b1120`, `--card: #131c31`, `--card-border: #1e293b`
  - `--accent: #3b82f6`, `--success: #22c55e`, `--warning: #f59e0b`, `--danger: #ef4444`
  - Fonts: Geist Sans + Geist Mono
- **No state management library** — local `useState` + polling
- **No UI library** — all components hand-built with Tailwind
- **Path alias**: `@/*` maps to `src/*`
- **API proxy**: `next.config.ts` rewrites `/api/:path*` to `http://localhost:3000/:path*`

### Pages

| Page | Route | Key API Calls | Polling |
|------|-------|--------------|---------|
| Dashboard | `/` | fetchHealth, fetchPayments, fetchCircuitBreakers, fetchBulkheads | 3-5s |
| Payments | `/payments` | fetchPayments (paginated) | — |
| New Payment | `/payments/new` | createPayment | — |
| Payment Detail | `/payments/[id]` | getPayment, getPaymentEvents, replayPayment, getPaymentStateAt | — |
| Providers | `/providers` | fetchProviders, fetchProviderMetrics, simulateRouting | 5s |
| Chaos Engineering | `/chaos` | fetchChaosConfig, updateChaosConfig, resetChaos | — |
| Fraud Rules | `/fraud` | fetchFraudRules, createFraudRule, updateFraudRule, deleteFraudRule, simulateFraud | — |
| Tokens | `/tokens` | fetchTokens, revokeToken | — |
| Webhooks | `/webhooks` | registerWebhook, fetchWebhookRegistrations, fetchWebhookDeliveries, fetchDeadLetterQueue, retryDeadLetter | — |
| Metrics | `/metrics` | fetchMetrics | 5s |
| Idempotency | `/idempotency` | Direct fetch to /api/payments with Idempotency-Key | — |
| Signature Verify | `/verify` | verifyWebhookSignature | — |
| Logs | `/logs` | fetchLogs | 3s |

### Components

| Component | Props | Purpose |
|-----------|-------|---------|
| `status-badge.tsx` | `{ status: string }` | Colored badge (completed=green, failed=red, compensated=orange, pending=gray) |
| `circuit-breaker-card.tsx` | `{ breaker, onReset }` | CB state card with colored dot and reset button |
| `event-timeline.tsx` | `{ events: DomainEvent[] }` | Vertical timeline with 28 event type colors/descriptions |
| `saga-flow.tsx` | `{ completedEvents, status }` | Horizontal 4-step flow with result indicator |

## Configuration

All config via environment variables with defaults in `src/core/config.ts`:

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | 3000 | API server port |
| `DATABASE_URL` | postgresql://...localhost | Connection string |
| `WEBHOOK_SECRET` | dev-webhook-secret | HMAC-SHA256 signing key |
| `PAYMENT_PROVIDER_FAILURE_RATE` | 0.1 | Applied to all 3 PSPs (0.0 in Docker) |
| `INVENTORY_SERVICE_FAILURE_RATE` | 0.05 | (0.0 in Docker) |
| `NOTIFICATION_SERVICE_FAILURE_RATE` | 0.05 | (0.0 in Docker) |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | 5 | Failures before open |
| `CIRCUIT_BREAKER_TIMEOUT_MS` | 30000 | Open→half-open timeout |
| `IDEMPOTENCY_TTL_MS` | 86400000 | 24 hours |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (none, console) | Set to `http://jaeger:4317` in Docker |

## Docker

Three services in `docker-compose.yml`:
- **postgres**: PostgreSQL 16-alpine on :5432 with healthcheck
- **app**: Express API on :3000 (depends on postgres healthy + jaeger started)
- **jaeger**: All-in-one :16686 (UI) + :4317 (OTLP gRPC)

Volume: `postgres-data` for persistence.

## API Endpoints

### Public (`src/api/routes.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | DB connectivity check |
| `GET` | `/payments` | Paginated list (`?limit=&offset=`) |
| `POST` | `/payments` | Start payment saga (requires `Idempotency-Key`; accepts `region`, `card`, `token`) |
| `GET` | `/payments/:id` | Current state from snapshot + event replay |
| `GET` | `/payments/:id/events` | Full event history |
| `GET` | `/payments/:id/state?at=` | Temporal query at ISO date |
| `POST` | `/payments/:id/replay` | Rebuild state bypassing snapshot |
| `POST` | `/webhooks/register` | Register callback URL |
| `GET` | `/webhooks/registrations` | List registrations |
| `GET` | `/webhooks/deliveries` | Delivery history (last 100) |
| `GET` | `/webhooks/dlq` | Dead-letter queue (last 100) |
| `POST` | `/webhooks/dlq/:id/retry` | Retry DLQ entry |

### Admin (`src/api/admin-routes.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET/POST` | `/admin/chaos` | Read/update chaos config per service |
| `POST` | `/admin/chaos/reset` | Reset all chaos to initial config |
| `GET` | `/admin/circuit-breakers` | All 5 breaker states |
| `POST` | `/admin/circuit-breakers/:name/reset` | Reset specific breaker |
| `GET` | `/admin/metrics` | Counters + histograms snapshot |
| `POST` | `/admin/metrics/reset` | Reset all metrics |
| `GET` | `/admin/logs?limit=` | Recent logs from 500-entry buffer |
| `GET` | `/admin/bulkheads` | Concurrency stats for 3 bulkheads |
| `POST` | `/admin/saga-recovery` | Trigger recovery scan |
| `POST` | `/webhooks/verify` | HMAC-SHA256 verification playground |
| `GET` | `/admin/providers` | All providers with config + CB state |
| `GET` | `/admin/providers/:name/metrics?window=` | Per-provider stats (default 1h window) |
| `GET` | `/admin/providers/metrics?window=` | All provider stats |
| `GET` | `/admin/routing/simulate?amount=&currency=&region=` | Simulate routing decision |
| `GET` | `/admin/fraud/rules` | List all fraud rules |
| `POST` | `/admin/fraud/rules` | Create fraud rule |
| `PUT` | `/admin/fraud/rules/:id` | Update fraud rule |
| `DELETE` | `/admin/fraud/rules/:id` | Delete fraud rule |
| `GET` | `/payments/:id/fraud` | Fraud evaluation for a payment |
| `POST` | `/admin/fraud/simulate` | Simulate fraud scoring |
| `GET` | `/tokens?customerId=` | List tokens (optional filter) |
| `GET` | `/tokens/:token` | Token details |
| `POST` | `/tokens/revoke/:token` | Revoke a token |
| `GET/POST` | `/admin/fx/rates` | Read/update FX rate pairs |
| `GET` | `/admin/decline-codes` | List all 13 decline codes |
| `GET` | `/payments/:id/retries` | Retry history for a payment |

### GraphQL (`/graphql`)

- **Queries**: `payment`, `payments` (cursor pagination), `paymentEvents`, `providers`, `fraudRules`, `fxRates`, `declineCodes`, `metrics`
- **Mutations**: `createPayment`, `registerWebhook`, `upsertFraudRule`, `deleteFraudRule`, `updateChaos`, `revokeToken`, `updateFxRate`
- **Subscriptions**: `paymentStatusChanged(paymentId?)` via in-process PubSub
- **GraphiQL**: Available at `GET /graphql`

## Key Constants

| Constant | Value | Location |
|----------|-------|----------|
| `SNAPSHOT_THRESHOLD` | 10 | `snapshot-store.ts` |
| `MAX_ATTEMPTS` (webhooks) | 3 | `webhook-delivery.ts` |
| `MAX_FALLBACK_ATTEMPTS` | 3 | `routing-engine.ts` |
| `METRICS_WINDOW_MS` | 3,600,000 (1h) | `routing-engine.ts` |
| `LOG_BUFFER_SIZE` | 500 | `logger.ts` |
| `ALLOW_THRESHOLD` | 30 | `fraud-engine.ts` |
| `REVIEW_THRESHOLD` | 70 | `fraud-engine.ts` |
| Webhook scheduler interval | 5,000ms | `main.ts` |
| Histogram max values | 10,000 | `metrics-collector.ts` |
| CB backoff cap | 2^5 attempts | `circuit-breaker.ts` |

## Provider Configuration

| Provider | Currencies | Regions | Cost (bps) | Settlement | Priority |
|----------|-----------|---------|------------|-----------|----------|
| Stripe | USD, EUR, GBP | US, EU, APAC | 290 | USD | 1 |
| Adyen | EUR, GBP, USD, JOD | EU, ME, APAC, US | 250 | EUR | 2 |
| PayPal | USD, EUR, GBP | US, EU | 349 | USD | 3 |

## Event Types (28 total)

**Saga lifecycle**: `PaymentInitiated`, `PaymentValidated`, `PaymentValidationFailed`, `InventoryReserved`, `InventoryReservationFailed`, `PaymentCharged`, `PaymentChargeFailed`, `NotificationSent`, `NotificationFailed`, `PaymentCompleted`, `PaymentFailed`

**Compensation**: `CompensationStarted`, `CompensationCompleted`, `InventoryReleased`, `PaymentRefunded`

**Routing**: `ProviderSelected`, `ProviderFallback`, `ProviderRoutingFailed`

**Decline/Retry**: `PaymentDeclined`, `RetryScheduled`, `RetryAttempted`, `RetryExhausted`

**Fraud**: `FraudCleared`, `FraudReview`, `FraudBlocked`

**Tokenization**: `CardTokenized`, `TokenUsed`

**FX**: `CurrencyConverted`

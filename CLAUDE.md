# Payment Orchestrator

## What This Is

A production-grade payment processing system demonstrating distributed systems patterns: multi-provider routing, saga orchestration, event sourcing, fraud scoring, tokenization, multi-currency FX, GraphQL, OpenTelemetry, and chaos engineering. Express API + PostgreSQL backend, Next.js dashboard frontend. All amounts in **cents** (integer `Cents` type).

## Quick Reference

```bash
# Backend (from project root)
npm test                  # 49 Vitest unit tests
npx tsc --noEmit          # Type check backend

# Dashboard (from dashboard/)
cd dashboard && npx tsc --noEmit   # Type check frontend

# Docker
docker-compose up --build -d       # API on :3000, dashboard on :3001
docker-compose down -v             # Tear down with volume cleanup

# Database
npx prisma migrate dev             # Dev migration
npx prisma migrate deploy          # Production migration
npx prisma generate                # Regenerate client
```

## Architecture

### Dependency Flow

```
main.ts (entry point, wires everything)
  core/*            config, logger, correlation, database, result
  chaos-controller  runtime failure injection
  metrics-collector in-memory counters + histograms
  payment-service   (aggregates all domain logic)
    event-store + snapshot-store + payment-projection
    saga-orchestrator + payment-saga (4 steps)
    circuit-breaker-registry (3 breakers)
    bulkhead (3 concurrency limiters)
    external-services/* (payment-provider, inventory, notification)
    webhook-delivery
    idempotency-middleware
  routes            public API endpoints
  admin-routes      chaos/CB/metrics/logs/bulkhead/saga-recovery
  webhook-scheduler 5s interval retry processor
  saga-recovery     startup scan for incomplete sagas
```

### Key Patterns

| Pattern | Where | Notes |
|---------|-------|-------|
| **Saga Orchestration** | `src/saga/` | 4 steps: validate, reserve inventory, charge, notify. Compensation in reverse. Notification failure is non-critical. |
| **Event Sourcing** | `src/events/` | Append-only events, state via reducer replay. Optimistic locking via unique `(aggregateId, version)`. |
| **Temporal Queries** | `event-store.ts` | `getByAggregateIdAt()` replays events up to a timestamp. |
| **Snapshots** | `snapshot-store.ts` | After `SNAPSHOT_THRESHOLD` (10) events, snapshot avoids full replay. |
| **Circuit Breaker** | `src/circuit-breaker/` | Closed/open/half-open. Exponential backoff with jitter, capped at 2^5. Registry pattern for centralized management. |
| **Bulkhead** | `src/bulkhead/` | Per-service concurrency limits with queue overflow rejection. |
| **Chaos Engineering** | `src/chaos/` | Runtime failure rate + latency injection per service, no restart needed. |
| **Idempotency** | `src/idempotency/` | `Idempotency-Key` header, cached responses, 24h TTL. |
| **Webhooks** | `src/webhooks/` | HMAC-SHA256 signed, 3 retries with exponential backoff, then DLQ. 5s scheduler interval. |
| **Result\<T, E\>** | `src/core/result.ts` | Discriminated union. Business logic never throws. `unwrap()` only at HTTP boundaries. |
| **RFC 7807** | `src/middleware/error-handler.ts` | All error responses are Problem Details. |
| **Correlation IDs** | `src/core/correlation.ts` | `X-Request-ID` propagated through every request. |

## Code Conventions

### TypeScript

- **Strict mode** with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- **ESM only** (`"type": "module"` in package.json)
- Relative imports with `.js` extension: `import { ok } from "../core/result.js"`
- `type` keyword for type-only imports: `import type { Request } from "express"`
- Named exports preferred. No barrel/index files.
- Optional properties use `?: T | undefined` (required by `exactOptionalPropertyTypes`)

### Factory Pattern (No Classes)

Every module exports a `createX(deps)` factory returning an interface. Dependencies injected explicitly:

```typescript
// Pattern used everywhere
export interface EventStore { /* methods */ }
export function createEventStore(prisma: PrismaClient): EventStore { ... }
```

No `new` keyword anywhere in the codebase. No class inheritance.

### Error Handling

- Custom error classes with codes: `PaymentServiceError`, `EventStoreError`, `CircuitBreakerError`, `BulkheadError`, `SagaError`, `WebhookError`
- Error code to HTTP status mapping: `VALIDATION` -> 400, `NOT_FOUND` -> 404, `SAGA_FAILED` -> 422, `INTERNAL` -> 500
- `respondProblem(res, status, title, detail)` and `respondFromError(res, error)` helpers in `routes.ts`
- Prisma `P2002` error code = optimistic lock conflict (event store version constraint)

### Naming

- Files: `kebab-case.ts`
- Factories: `createXxx()`
- Interfaces: `PascalCase` (e.g., `EventStore`, `CircuitBreaker`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `SNAPSHOT_THRESHOLD`, `MAX_ATTEMPTS`, `SERVICE_NAME`)
- Event types: `PascalCase` strings (e.g., `PaymentInitiated`, `InventoryReserved`)

## File Structure

```
src/
  core/               Result type, types, config, database, logger, correlation
  events/             Event store, snapshot store, payment projection (reducer)
  saga/               Orchestrator, payment saga steps, startup recovery
  circuit-breaker/    Circuit breaker, registry pattern
  bulkhead/           Concurrency limiter
  chaos/              Runtime failure injection
  metrics/            In-memory counters and histograms
  idempotency/        Idempotency middleware (Express)
  webhooks/           Webhook delivery, HMAC signing, DLQ, retry scheduler
  external-services/  Stubbed services driven by chaos controller
  api/                Payment service (aggregator), routes, admin routes
  middleware/         Error handler, request logger
  main.ts             Entry point

dashboard/
  src/app/            10 pages (Next.js App Router, all "use client")
  src/components/     4 shared components (status-badge, circuit-breaker-card, event-timeline, saga-flow)
  src/lib/api.ts      API client with 18+ fetch functions, all types
  next.config.ts      Rewrites /api/* to localhost:3000/*
```

## Database (Prisma + PostgreSQL)

Schema in `prisma/schema.prisma`. 7 models:

| Model | Table | Purpose |
|-------|-------|---------|
| `SagaExecution` | saga_executions | Saga state persistence for crash recovery |
| `EventStore` | event_store | Append-only domain events with version locking |
| `EventSnapshot` | event_snapshots | Snapshot optimization for event replay |
| `IdempotencyKey` | idempotency_keys | Cached responses keyed by idempotency header |
| `WebhookDelivery` | webhook_deliveries | Webhook delivery tracking with retry state |
| `WebhookRegistration` | webhook_registrations | Registered callback URLs and event filters |
| `DeadLetterQueue` | dead_letter_queue | Failed webhooks after max retries |

Key constraints:
- `EventStore` has unique `(aggregateId, version)` for optimistic locking
- `EventSnapshot` has unique `aggregateId` (upserted on save)
- `IdempotencyKey` has unique `key`

## Testing

- **Framework**: Vitest with globals, Node environment, 10s timeout
- **49 unit tests** across 6 test files in `src/`
- **Mock strategy**: Custom `createMockPrisma()` factories with in-memory state tracking. `vi.fn()` + `mockImplementation`. Global `fetch` mocked with `vi.spyOn` for webhook tests.
- **No integration tests** — all external boundaries mocked
- Test files live next to source: `saga-orchestrator.test.ts` beside `saga-orchestrator.ts`

| Test File | What It Covers | Tests |
|-----------|---------------|-------|
| `saga-orchestrator.test.ts` | Happy path, compensation, failure, persistence | 7 |
| `circuit-breaker.test.ts` | State transitions, backoff calculation | 11 |
| `webhook-delivery.test.ts` | Registration, delivery, HMAC, DLQ, filtering | 11 |
| `chaos-controller.test.ts` | Failure rates, config updates, shouldFail | 9 |
| `bulkhead.test.ts` | Concurrency limits, queueing, rejection | 5 |
| `metrics-collector.test.ts` | Counters, histograms, percentiles, reset | 6 |

## Dashboard (Next.js)

- **Next.js 16** with App Router, React 19, Tailwind CSS v4
- **All pages are client components** (`"use client"`)
- **Dark theme** with CSS custom properties in `globals.css`
- **No state management library** — local `useState` + polling (3-5s intervals)
- **No UI library** — all components hand-built with Tailwind
- **Path alias**: `@/*` maps to `src/*`
- API proxy: `next.config.ts` rewrites `/api/:path*` to `http://localhost:3000/:path*`

## Configuration

All config via environment variables with defaults in `src/core/config.ts`:

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | 3000 | API server port |
| `DATABASE_URL` | postgresql://...localhost | Connection string |
| `WEBHOOK_SECRET` | dev-webhook-secret | HMAC signing key |
| `PAYMENT_PROVIDER_FAILURE_RATE` | 0.1 | Chaos default (0.0 in docker) |
| `INVENTORY_SERVICE_FAILURE_RATE` | 0.05 | Chaos default (0.0 in docker) |
| `NOTIFICATION_SERVICE_FAILURE_RATE` | 0.05 | Chaos default (0.0 in docker) |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | 5 | Failures before open |
| `CIRCUIT_BREAKER_TIMEOUT_MS` | 30000 | Reset timeout |
| `IDEMPOTENCY_TTL_MS` | 86400000 | 24 hours |

## API Endpoints

### Public (`src/api/routes.ts`)

- `GET /health` — DB connectivity
- `GET /payments` — Paginated list (`?limit=&offset=`)
- `POST /payments` — Start saga (requires `Idempotency-Key` header)
- `GET /payments/:id` — Current state from event replay + snapshots
- `GET /payments/:id/events` — Full event history
- `GET /payments/:id/state?at=` — Temporal query
- `POST /payments/:id/replay` — Rebuild state bypassing snapshot
- `POST /webhooks/register` — Register callback URL
- `GET /webhooks/registrations` — List registrations
- `GET /webhooks/deliveries` — Delivery history
- `GET /webhooks/dlq` — Dead-letter queue
- `POST /webhooks/dlq/:id/retry` — Retry DLQ entry

### Admin (`src/api/admin-routes.ts`)

- `GET/POST /admin/chaos` — Read/update chaos config
- `POST /admin/chaos/reset` — Reset chaos to defaults
- `GET /admin/circuit-breakers` — All breaker states
- `POST /admin/circuit-breakers/:name/reset` — Reset specific breaker
- `GET /admin/metrics` — Counters + histograms snapshot
- `GET /admin/logs` — Recent structured log entries (in-memory buffer, 500 max)
- `GET /admin/bulkheads` — Concurrency stats
- `POST /admin/saga-recovery` — Trigger recovery scan
- `POST /webhooks/verify` — HMAC-SHA256 signature verification

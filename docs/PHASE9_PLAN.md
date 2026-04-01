# Phase 9: Platform Reliability — Queues, Caching, Load Testing & Health Checks

## Overview

Add production-grade infrastructure to the payment orchestrator: BullMQ for async job processing, Redis for caching and rate limiting, k6 load test suite, and comprehensive health/readiness endpoints with Prometheus metrics.

---

## 9A: Message Queue (BullMQ + Redis)

### Dependencies

```
bullmq ^5.0.0    — Queue + Worker + QueueEvents
ioredis ^5.0.0   — Redis client (required by BullMQ)
```

### Queue Definitions

| Queue | Purpose | Concurrency | Rate Limit | DLQ |
|-------|---------|-------------|------------|-----|
| `payment-processing` | Saga step execution | 10 | 50/sec | yes |
| `webhook-delivery` | Webhook sending with retries | 5 | 100/sec | yes |
| `settlement-calculation` | Periodic settlement jobs | 2 | — | yes |
| `dunning-retry` | Subscription payment retries | 3 | 10/sec | yes |
| `report-generation` | Async report building | 2 | — | yes |
| `dispute-resolution` | Simulated dispute lifecycle | 3 | — | yes |
| `metrics-computation` | Periodic analytics calculation | 1 | — | yes |

### Architecture

```
src/queue/
  queue-service.ts          — Queue registry, connection management, factory
  queue-service.test.ts     — Unit tests for queue configuration and helpers
  workers/
    payment-worker.ts       — Processes payment saga jobs
    webhook-worker.ts       — Processes webhook delivery jobs
    settlement-worker.ts    — Processes settlement calculation jobs
    dunning-worker.ts       — Processes dunning retry jobs
    report-worker.ts        — Processes report generation jobs
    dispute-worker.ts       — Processes dispute lifecycle progression
    metrics-worker.ts       — Processes analytics computation jobs
```

### Queue Service Interface

```typescript
interface QueueService {
  getQueue(name: QueueName): Queue;
  addJob(queue: QueueName, data: Record<string, unknown>, opts?: JobOptions): Promise<Job>;
  addRepeatable(queue: QueueName, data: Record<string, unknown>, pattern: string): Promise<Job>;
  getQueueStats(): Promise<QueueStats[]>;
  getJobCounts(queue: QueueName): Promise<JobCounts>;
  getFailedJobs(queue: QueueName, limit: number): Promise<Job[]>;
  retryJob(queue: QueueName, jobId: string): Promise<void>;
  drainQueue(queue: QueueName): Promise<void>;
  closeAll(): Promise<void>;
}

type QueueName =
  | "payment-processing"
  | "webhook-delivery"
  | "settlement-calculation"
  | "dunning-retry"
  | "report-generation"
  | "dispute-resolution"
  | "metrics-computation";

interface QueueStats {
  name: QueueName;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
  processingRate: number;
}
```

### Webhook Scheduler Migration

Replace the `setInterval`-based webhook scheduler with a BullMQ repeatable job:

**Before** (`webhook-scheduler.ts`):
```typescript
timer = setInterval(() => processRetries(), 5000);
```

**After** (via `webhook-worker.ts`):
```typescript
// Repeatable job: every 5 seconds
queue.add("process-retries", {}, { repeat: { every: 5000 } });
```

The existing `WebhookScheduler` interface is preserved. `createWebhookScheduler` will accept an optional `QueueService` — when provided, it delegates to BullMQ; when absent, falls back to `setInterval` for environments without Redis.

### Admin Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/queues` | All queue stats |
| `GET` | `/admin/queues/:name` | Single queue stats with recent jobs |
| `GET` | `/admin/queues/:name/failed` | Failed jobs for a queue |
| `POST` | `/admin/queues/:name/retry/:jobId` | Retry a failed job |
| `POST` | `/admin/queues/:name/drain` | Drain all jobs from a queue |
| `POST` | `/admin/queues/:name/pause` | Pause a queue |
| `POST` | `/admin/queues/:name/resume` | Resume a paused queue |

### Dashboard Page

New page at `/queues` showing:
- Queue overview cards (7 queues): waiting, active, completed, failed counts
- Processing rate per queue
- Failed jobs table with retry button
- Pause/resume toggle per queue
- Auto-refresh every 3 seconds

---

## 9B: Caching Layer (Redis)

### Cache Service Interface

```typescript
interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  delPattern(pattern: string): Promise<number>;
  increment(key: string, ttlSeconds?: number): Promise<number>;
  slidingWindowCount(key: string, windowSeconds: number): Promise<number>;
  slidingWindowAdd(key: string, windowSeconds: number): Promise<number>;
  isAvailable(): Promise<boolean>;
  close(): Promise<void>;
}
```

### Cache Targets

| Target | Key Pattern | TTL | Invalidation |
|--------|-------------|-----|-------------|
| API key lookups | `apikey:{hashedKey}` | 5 min | On key revoke/update |
| Tenant settings | `tenant:{tenantId}:settings` | 10 min | On tenant update |
| Provider health | `provider:{name}:health` | 30 sec | On CB state change |
| Analytics snapshots | `analytics:{tenantId}:{metric}:{window}` | 5 min | On recompute |
| Rate limit counters | `ratelimit:{tenantId}:{endpoint}` | Sliding window | Auto-expire |
| Idempotency responses | `idempotency:{tenantId}:{key}` | 24h | Auto-expire |

### Architecture

```
src/cache/
  cache-service.ts          — Redis cache abstraction with typed get/set
  cache-service.test.ts     — Unit tests (mock Redis)
```

### Graceful Degradation

Redis is optional. When unavailable:
- Cache misses fall through to database (no error)
- Rate limiting falls back to in-memory counters
- Idempotency continues using PostgreSQL
- `isAvailable()` returns false; all `get()` calls return `null`

### Event-Driven Invalidation

Cache entries are invalidated when relevant events occur:
- `apikey:*` invalidated when API key is updated/revoked via `apiKeyService`
- `tenant:*` invalidated when tenant settings change via `tenantService`
- `provider:*` invalidated when circuit breaker state changes

Integration point: add `cacheService.del()` calls to the existing service methods that mutate cached data.

---

## 9C: Load Testing (k6)

### Test Scripts

```
load-tests/
  config.js                 — Shared config (base URL, thresholds, auth)
  scenarios/
    normal-traffic.js       — 50 payments/sec for 5 minutes
    provider-failure.js     — 50/sec, kill provider at 2 min
    spike.js                — Ramp 10→200 payments/sec in 30 seconds
    billing-wave.js         — 1000 invoices simultaneously
  helpers/
    payment.js              — Payment creation helpers
    auth.js                 — API key setup
  report-template.md        — Markdown report template
```

### Scenarios

**1. Normal Traffic**
- Ramp: 0→50 VUs over 30s, hold 50 VUs for 5 min, ramp down 30s
- Assert: p95 < 500ms, error rate < 1%, throughput > 40 payments/sec

**2. Provider Failure**
- Start at 50 VUs, at 2 min trigger chaos endpoint to fail one provider
- Assert: routing failover happens, error rate stays < 5%, no payment loss

**3. Spike**
- Ramp: 10→200 VUs in 30 seconds
- Assert: p99 < 2000ms, no 5xx errors, circuit breakers trigger if needed

**4. Subscription Billing Wave**
- Burst: 100 VUs each creating 10 invoices simultaneously
- Assert: all 1000 invoices created, p95 < 1000ms

### Captured Metrics

For each scenario:
- p50, p95, p99 latency
- Error rate (4xx, 5xx separately)
- Throughput (successful payments per second)
- Provider distribution (via admin metrics endpoint)
- Queue depths (via admin queues endpoint)

### Report

Generated as `load-tests/REPORT.md` with:
- Summary table per scenario
- Latency distribution charts (ASCII)
- Provider failover analysis
- Recommendations

---

## 9D: Health Checks & Readiness

### Endpoints

**`GET /health`** — Liveness probe (fast, no dependencies)
```json
{ "status": "ok", "timestamp": "2024-01-15T10:30:00Z" }
```

**`GET /health/ready`** — Readiness probe (checks all subsystems)
```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "up", "latencyMs": 2 },
    "redis": { "status": "up", "latencyMs": 1 },
    "providers": {
      "stripe": { "status": "up", "circuitBreaker": "closed" },
      "adyen": { "status": "degraded", "circuitBreaker": "half-open" },
      "paypal": { "status": "up", "circuitBreaker": "closed" }
    },
    "queues": {
      "payment-processing": { "depth": 12, "processing": 3 },
      "webhook-delivery": { "depth": 5, "processing": 2 }
    }
  },
  "version": "2.0.0",
  "uptime": "4d 12h 33m"
}
```

Status determination:
- `healthy` — all checks pass
- `degraded` — non-critical check failing (e.g. one provider circuit open)
- `unhealthy` — critical check failing (database or Redis down)

**`GET /health/metrics`** — Prometheus text format
```
# HELP payment_requests_total Total payment requests
# TYPE payment_requests_total counter
payment_requests_total 1523

# HELP payment_duration_seconds Payment processing duration
# TYPE payment_duration_seconds histogram
payment_duration_seconds_bucket{le="0.1"} 800
payment_duration_seconds_bucket{le="0.5"} 1400
payment_duration_seconds_bucket{le="1.0"} 1500
payment_duration_seconds_bucket{le="+Inf"} 1523
payment_duration_seconds_sum 412.5
payment_duration_seconds_count 1523

# HELP circuit_breaker_state Circuit breaker state (0=closed, 1=half-open, 2=open)
# TYPE circuit_breaker_state gauge
circuit_breaker_state{provider="stripe"} 0
circuit_breaker_state{provider="adyen"} 1

# HELP queue_depth Number of jobs waiting in queue
# TYPE queue_depth gauge
queue_depth{queue="payment-processing"} 12
queue_depth{queue="webhook-delivery"} 5
```

### Architecture

```
src/health/
  health-service.ts         — Readiness check orchestration
  health-service.test.ts    — Unit tests
  prometheus.ts             — Prometheus text format exporter
  prometheus.test.ts        — Unit tests
```

### Health Service Interface

```typescript
interface HealthService {
  liveness(): LivenessResult;
  readiness(): Promise<ReadinessResult>;
  prometheusMetrics(): string;
}

interface ReadinessResult {
  status: "healthy" | "degraded" | "unhealthy";
  checks: {
    database: SubsystemCheck;
    redis: SubsystemCheck;
    providers: Record<string, ProviderCheck>;
    queues: Record<string, QueueCheck>;
  };
  version: string;
  uptime: string;
}
```

### Docker Compose Updates

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    volumes:
      - redis-data:/data

  app:
    environment:
      REDIS_URL: redis://redis:6379
    depends_on:
      redis:
        condition: service_healthy

  bull-board:
    build: .
    command: ["node", "dist/bull-board.js"]
    ports:
      - "3002:3002"
    environment:
      REDIS_URL: redis://redis:6379
      PORT: "3002"
    depends_on:
      redis:
        condition: service_healthy
```

---

## New Configuration

| Variable | Default | Notes |
|----------|---------|-------|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `QUEUE_CONCURRENCY_DEFAULT` | 5 | Default worker concurrency |
| `CACHE_ENABLED` | `true` | Toggle Redis caching |

---

## File Changes Summary

### New Files

| File | Purpose | Lines (est.) |
|------|---------|-------------|
| `src/queue/queue-service.ts` | Queue registry and connection management | ~200 |
| `src/queue/queue-service.test.ts` | Queue service tests | ~120 |
| `src/queue/workers/payment-worker.ts` | Payment processing worker | ~60 |
| `src/queue/workers/webhook-worker.ts` | Webhook delivery worker | ~70 |
| `src/queue/workers/settlement-worker.ts` | Settlement calculation worker | ~50 |
| `src/queue/workers/dunning-worker.ts` | Dunning retry worker | ~50 |
| `src/queue/workers/report-worker.ts` | Report generation worker | ~50 |
| `src/queue/workers/dispute-worker.ts` | Dispute lifecycle worker | ~60 |
| `src/queue/workers/metrics-worker.ts` | Analytics computation worker | ~50 |
| `src/cache/cache-service.ts` | Redis cache abstraction | ~150 |
| `src/cache/cache-service.test.ts` | Cache service tests | ~100 |
| `src/health/health-service.ts` | Readiness check orchestration | ~180 |
| `src/health/health-service.test.ts` | Health service tests | ~120 |
| `src/health/prometheus.ts` | Prometheus text format exporter | ~120 |
| `src/health/prometheus.test.ts` | Prometheus exporter tests | ~80 |
| `load-tests/config.js` | Shared k6 config | ~40 |
| `load-tests/scenarios/normal-traffic.js` | Normal traffic scenario | ~80 |
| `load-tests/scenarios/provider-failure.js` | Provider failure scenario | ~90 |
| `load-tests/scenarios/spike.js` | Spike scenario | ~70 |
| `load-tests/scenarios/billing-wave.js` | Billing wave scenario | ~70 |
| `load-tests/helpers/payment.js` | k6 payment helpers | ~40 |
| `load-tests/helpers/auth.js` | k6 auth helpers | ~30 |
| `load-tests/REPORT.md` | Load test report template | ~100 |
| `dashboard/src/app/queues/page.tsx` | Queue monitoring dashboard | ~250 |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Add `bullmq`, `ioredis` dependencies |
| `src/core/config.ts` | Add `redisUrl`, `queueConcurrency`, `cacheEnabled` |
| `src/main.ts` | Initialize Redis, queue service, health service; mount new routes |
| `src/api/routes.ts` | Enhanced `/health`, add `/health/ready`, `/health/metrics` |
| `src/api/admin-routes.ts` | Add queue management endpoints |
| `src/webhooks/webhook-scheduler.ts` | Accept optional queue service for BullMQ mode |
| `src/api/payment-service.ts` | Wire cache and queue services into factory |
| `src/auth/api-key-middleware.ts` | Add cache lookup before DB query |
| `dashboard/src/app/shell.tsx` | Add Queues nav item |
| `dashboard/src/lib/api.ts` | Add queue and health API functions |
| `docker-compose.yml` | Add Redis service, bull-board, update depends_on |

---

## Testing Plan

### Unit Tests (~60 new tests)

| Module | Tests | Description |
|--------|-------|-------------|
| `queue-service.test.ts` | ~15 | Queue creation, job add, stats, retry, drain |
| `cache-service.test.ts` | ~12 | Get/set/del, TTL, pattern delete, sliding window, graceful degradation |
| `health-service.test.ts` | ~15 | Liveness, readiness (all healthy, degraded, unhealthy), subsystem checks |
| `prometheus.test.ts` | ~10 | Counter format, histogram format, gauge format, label encoding |
| Worker tests (inline) | ~8 | Each worker processes jobs correctly |

### Verification

```bash
npx tsc --noEmit                    # Backend type check
cd dashboard && npx tsc --noEmit    # Dashboard type check
npm test                            # All tests pass
```

---

## Implementation Order

1. **Redis + Cache** — Foundation (ioredis connection, cache service)
2. **Queue Service** — Queue registry, connection management
3. **Workers** — All 7 worker implementations
4. **Webhook migration** — Replace setInterval with BullMQ
5. **Cache integration** — Wire cache into API key middleware, tenant service
6. **Health service** — Readiness checks, Prometheus exporter
7. **Health endpoints** — Enhanced /health, /health/ready, /health/metrics
8. **Admin queue endpoints** — Queue stats, failed jobs, retry, drain
9. **Docker compose** — Redis service, bull-board, health checks
10. **Dashboard** — Queue monitoring page
11. **Load tests** — k6 scripts and report
12. **Type check + test** — Final verification

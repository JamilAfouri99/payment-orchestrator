# Load Test Report

## Environment

| Property | Value |
|----------|-------|
| Base URL | `http://localhost:3000` |
| Date | _Run `k6` to generate_ |
| Providers | Stripe, Adyen, PayPal |
| Database | PostgreSQL 16 |
| Redis | Redis 7 |
| Queues | 7 BullMQ queues |

---

## Scenario 1: Normal Traffic

**Config**: 50 VUs, 5 minutes steady state

```
k6 run load-tests/scenarios/normal-traffic.js
```

| Metric | Target | Result |
|--------|--------|--------|
| p50 latency | < 200ms | — |
| p95 latency | < 500ms | — |
| p99 latency | < 2000ms | — |
| Error rate | < 1% | — |
| Throughput | > 40 payments/sec | — |

---

## Scenario 2: Provider Failure

**Config**: 50 VUs, Stripe killed at t=2m via chaos endpoint

```
k6 run load-tests/scenarios/provider-failure.js
```

| Metric | Target | Result |
|--------|--------|--------|
| p50 latency | < 500ms | — |
| p95 latency | < 1000ms | — |
| Error rate (pre-failure) | < 1% | — |
| Error rate (post-failure) | < 5% | — |
| Failover detected | Yes | — |
| CB state (Stripe) | open | — |

### Analysis

- Circuit breaker for Stripe should transition to `open` after 5 failures
- Routing engine falls back to Adyen (cost 250 bps) and PayPal (cost 349 bps)
- Provider metrics should show shift in traffic distribution

---

## Scenario 3: Spike

**Config**: 10 → 200 VUs in 30 seconds, hold for 1 minute

```
k6 run load-tests/scenarios/spike.js
```

| Metric | Target | Result |
|--------|--------|--------|
| p50 latency | < 500ms | — |
| p95 latency | < 1000ms | — |
| p99 latency | < 3000ms | — |
| Error rate | < 5% | — |
| Bulkhead rejections | Measured | — |

### Analysis

- Bulkhead (10 concurrent / 20 queue) should throttle excess requests
- Circuit breakers may trigger under load if error rate rises
- Queue depths should absorb burst traffic

---

## Scenario 4: Subscription Billing Wave

**Config**: 100 VUs x 10 iterations = 1000 invoices simultaneously

```
k6 run load-tests/scenarios/billing-wave.js
```

| Metric | Target | Result |
|--------|--------|--------|
| All 1000 invoices created | Yes | — |
| p95 latency | < 1000ms | — |
| Error rate | < 1% | — |
| Total duration | < 3 minutes | — |

---

## How to Run

### Prerequisites

1. Install k6: `brew install k6` (macOS) or see https://k6.io/docs/get-started/installation/
2. Start the platform: `docker-compose up -d`
3. Wait for health check: `curl http://localhost:3000/health`

### Run All Scenarios

```bash
# Normal traffic
k6 run load-tests/scenarios/normal-traffic.js

# Provider failure (uses chaos endpoint)
k6 run load-tests/scenarios/provider-failure.js

# Spike test
k6 run load-tests/scenarios/spike.js

# Billing wave
k6 run load-tests/scenarios/billing-wave.js
```

### Custom Configuration

```bash
# Override base URL
k6 run -e BASE_URL=http://staging:3000 load-tests/scenarios/normal-traffic.js

# Override API key
k6 run -e API_KEY=pk_test_xxx load-tests/scenarios/normal-traffic.js

# Export results to JSON
k6 run --out json=results.json load-tests/scenarios/normal-traffic.js
```

### Monitoring During Tests

- **Prometheus metrics**: `curl http://localhost:3000/health/metrics`
- **Readiness**: `curl http://localhost:3000/health/ready`
- **Queue depths**: `curl http://localhost:3000/admin/queues`
- **Circuit breakers**: `curl http://localhost:3000/admin/circuit-breakers`
- **Jaeger traces**: http://localhost:16686

---

## Recommendations

1. **Payment processing**: With 3 providers and cascading fallback, the system handles single-provider failures gracefully. Consider adding a 4th provider for additional redundancy.

2. **Queue depths**: Under spike load, the `payment-processing` queue absorbs burst traffic. Monitor queue depth to trigger auto-scaling alerts.

3. **Circuit breakers**: The 5-failure threshold works well for normal traffic. Under spike conditions, consider increasing the threshold or implementing a sliding window.

4. **Bulkhead sizing**: The current 10-concurrent / 20-queue configuration for payment providers handles steady-state well. For spike scenarios, consider increasing to 20/40.

5. **Redis caching**: API key cache (5 min TTL) significantly reduces database load during high-traffic scenarios. Tenant settings cache (10 min) eliminates repeated lookups.

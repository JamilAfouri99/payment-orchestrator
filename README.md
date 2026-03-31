# Payment Orchestration System

A production-grade payment processing system that demonstrates distributed systems patterns: saga orchestration with compensation, event sourcing for audit trails, circuit breakers for resilience, idempotency for safe retries, and webhook delivery with dead-letter queues.

## Quick Start

```bash
git clone <repo-url> && cd payment-orchestrator
docker-compose up --build -d
```

Wait for the health check to pass (~30 seconds), then:

```bash
# Check health
curl http://localhost:3000/health

# Register a webhook endpoint (optional)
curl -X POST http://localhost:3000/webhooks/register \
  -H "Content-Type: application/json" \
  -d '{"url": "https://httpbin.org/post", "events": ["payment.completed", "payment.failed"]}'

# Create a payment
curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: pay-001" \
  -d '{
    "amount": 5000,
    "currency": "USD",
    "customerId": "cust_123",
    "orderId": "ord_456",
    "items": [{"productId": "prod_1", "quantity": 2, "pricePerUnit": 2500}]
  }'

# Get payment state (derived from events)
curl http://localhost:3000/payments/<payment-id>

# Get full event history
curl http://localhost:3000/payments/<payment-id>/events

# Retry the same payment (returns cached response)
curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: pay-001" \
  -d '{
    "amount": 5000,
    "currency": "USD",
    "customerId": "cust_123",
    "orderId": "ord_456",
    "items": [{"productId": "prod_1", "quantity": 2, "pricePerUnit": 2500}]
  }'
```

Clean up:

```bash
docker-compose down -v
```

## Architecture

```mermaid
graph TD
    Client[Client] -->|POST /payments| API[Express API]
    API -->|Idempotency-Key header| IM[Idempotency Middleware]
    IM --> PS[Payment Service]
    PS --> SO[Saga Orchestrator]
    SO -->|Step 1| V[Validate]
    SO -->|Step 2| RI[Reserve Inventory]
    SO -->|Step 3| CP[Charge Payment]
    SO -->|Step 4| N[Notify Customer]
    RI -->|wrapped by| CB1[Circuit Breaker]
    CP -->|wrapped by| CB2[Circuit Breaker]
    N -->|wrapped by| CB3[Circuit Breaker]
    CB1 --> IS[Inventory Service Stub]
    CB2 --> PP[Payment Provider Stub]
    CB3 --> NS[Notification Service Stub]
    SO -->|every step| ES[Event Store]
    PS -->|on completion| WH[Webhook Delivery]
    WH -->|failed 3x| DLQ[Dead Letter Queue]
    ES -->|append-only| DB[(PostgreSQL)]
    SO -->|persist state| DB
    IM -->|cache responses| DB
    WH -->|delivery records| DB
```

## Patterns Demonstrated

| Pattern | Description |
|---------|-------------|
| **Saga Orchestration** | Multi-step payment flow with automatic compensation on failure — each step defines execute() and compensate() |
| **Event Sourcing** | All payment state is derived by replaying an append-only event log, not from mutable columns |
| **Idempotency** | Idempotency-Key header ensures duplicate requests return cached responses without reprocessing |
| **Circuit Breaker** | Three-state (closed/open/half-open) protection around external services with exponential backoff and jitter |
| **Webhook Delivery** | HMAC-SHA256 signed webhooks with retry policy and dead-letter queue for permanently failed deliveries |
| **Result Type** | `Result<T, E>` union type replaces thrown exceptions in all business logic for explicit error handling |
| **Optimistic Locking** | Event store uses unique version constraints to prevent concurrent write conflicts |
| **RFC 7807** | All error responses follow the Problem Details standard |

## Why I Built This

Payment systems are where distributed systems patterns matter most — money can't be lost, duplicated, or stuck in limbo. This project demonstrates that I understand:

1. **Why sagas exist**: Distributed transactions across services (inventory, payments, notifications) can't use traditional ACID — saga compensation is the alternative.
2. **Why event sourcing**: When auditors or support engineers ask "what happened to this payment?", replaying events gives you the complete, immutable truth.
3. **Why idempotency**: Network retries, client timeouts, and load balancer replays mean your API *will* receive duplicate requests. Idempotency keys make this safe.
4. **Why circuit breakers**: When a downstream service degrades, you fail fast instead of cascading timeouts across your entire system.
5. **Why Result types**: Thrown exceptions are invisible in type signatures. `Result<T, E>` makes error paths explicit and forces callers to handle them.

## Tech Stack

- **Runtime**: Node.js 20+ with TypeScript (strict mode, ESM)
- **Database**: PostgreSQL 16 via Prisma ORM
- **API**: Express with RFC 7807 error responses
- **Testing**: Vitest (29 unit tests)
- **Infrastructure**: Docker + docker-compose (single command startup)

## Project Structure

```
src/
  core/           Result type, shared types, config, database
  events/         Event store, payment projection (reducer)
  saga/           Saga orchestrator, payment saga steps
  circuit-breaker/ Circuit breaker with exponential backoff
  idempotency/    Idempotency middleware
  webhooks/       Webhook delivery, HMAC signing, DLQ
  external-services/ Stubbed payment, inventory, notification services
  api/            Payment service, Express routes
  middleware/     Error handler
  main.ts         Application entry point
```

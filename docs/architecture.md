# Architecture

## System Overview

```mermaid
graph TD
    Client[Client / Dashboard] -->|POST /payments| API[Express API]
    API -->|X-Request-ID| COR[Correlation Middleware]
    COR -->|Idempotency-Key| IM[Idempotency Middleware]
    IM --> PS[Payment Service]
    PS --> SO[Saga Orchestrator]
    SO -->|Step 1| V[Validate]
    SO -->|Step 2| RI[Reserve Inventory]
    SO -->|Step 3| CP[Charge Payment]
    SO -->|Step 4| N[Notify Customer]
    RI -->|circuit breaker + bulkhead| IS[Inventory Service]
    CP -->|circuit breaker + bulkhead| PP[Payment Provider]
    N -->|circuit breaker + bulkhead| NS[Notification Service]
    IS & PP & NS -->|failure rates| CC[Chaos Controller]
    SO -->|every step| ES[Event Store]
    ES -->|snapshot after N events| SS[Snapshot Store]
    PS -->|on completion| WH[Webhook Delivery]
    WH -->|retry scheduler| WS[Webhook Scheduler]
    WH -->|failed 3x| DLQ[Dead Letter Queue]
    ES & SS & SO & IM & WH & DLQ -->|persist| DB[(PostgreSQL)]
    API --> LOG[Structured Logger]
    API --> MET[Metrics Collector]
    SO -->|on startup| SR[Saga Recovery]
```

## Saga State Machine

```mermaid
stateDiagram-v2
    [*] --> Pending: Payment initiated
    Pending --> Validating: Start saga
    Validating --> ReservingInventory: Validation passed
    Validating --> Failed: Validation failed
    ReservingInventory --> Charging: Inventory reserved
    ReservingInventory --> Compensating: Reservation failed
    Charging --> Notifying: Payment charged
    Charging --> Compensating: Charge failed
    Notifying --> Completed: Notification sent/failed
    Compensating --> Compensated: All steps reversed
    Compensating --> Failed: Compensation failed
    Completed --> [*]
    Compensated --> [*]
    Failed --> [*]
```

Each step implements `execute()` and `compensate()`. On failure at step N, the orchestrator calls `compensate()` on steps N-1 through 0 in reverse order. Saga state is persisted to `saga_executions` before and after each step, enabling recovery after crashes.

## Event Sourcing Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant EventStore
    participant SnapshotStore
    participant DB

    Client->>API: POST /payments
    API->>EventStore: append(PaymentInitiated, v1)
    EventStore->>DB: INSERT with unique(aggregate_id, version)
    Note over DB: Optimistic lock via unique constraint

    API->>EventStore: append(PaymentValidated, v2)
    API->>EventStore: append(InventoryReserved, v3)
    API->>EventStore: append(PaymentCharged, v4)
    API->>EventStore: append(PaymentCompleted, v5)

    Note over SnapshotStore: After N events, save snapshot

    Client->>API: GET /payments/:id
    API->>SnapshotStore: load(id)
    SnapshotStore-->>API: snapshot at v3
    API->>EventStore: getAfterVersion(id, v3)
    EventStore-->>API: [v4, v5]
    Note over API: Replay v4 + v5 onto snapshot state
    API-->>Client: Current PaymentState

    Client->>API: GET /payments/:id/state?at=T
    API->>EventStore: getByAggregateIdAt(id, T)
    EventStore-->>API: Events up to time T
    Note over API: Replay through reducer
    API-->>Client: Historical PaymentState
```

## Circuit Breaker States

```mermaid
stateDiagram-v2
    [*] --> Closed
    Closed --> Closed: Success
    Closed --> Closed: Failure (below threshold)
    Closed --> Open: Failure count >= threshold
    Open --> Open: Request rejected
    Open --> HalfOpen: Timeout elapsed (with backoff + jitter)
    HalfOpen --> Closed: Success
    HalfOpen --> Open: Failure
```

Each external service has its own circuit breaker instance, managed through a central registry. The admin API exposes breaker state and allows manual resets.

## Resilience Stack

```mermaid
graph LR
    Request --> BH[Bulkhead]
    BH -->|concurrency limit| CB[Circuit Breaker]
    CB -->|state check| CC[Chaos Controller]
    CC -->|failure injection| SVC[External Service]
    SVC -->|Result T, E| CB
    CB -->|record success/failure| BH
```

Three layers of protection wrap every external service call:
1. **Bulkhead**: Limits concurrent requests to prevent resource exhaustion
2. **Circuit Breaker**: Fails fast when a service is degraded
3. **Chaos Controller**: Enables runtime failure injection for testing

## Webhook Delivery + Dead Letter Queue

```mermaid
sequenceDiagram
    participant PaymentService
    participant WebhookService
    participant Scheduler
    participant DB
    participant Recipient

    PaymentService->>WebhookService: dispatch(event, payload)
    WebhookService->>DB: Find matching registrations
    WebhookService->>DB: Create delivery record

    WebhookService->>WebhookService: Sign with HMAC-SHA256
    WebhookService->>Recipient: POST with X-Webhook-Signature

    alt Success
        WebhookService->>DB: status = delivered
    else Failure (attempt < 3)
        WebhookService->>DB: status = pending, nextRetryAt
        Scheduler->>DB: Query pending retries
        Scheduler->>Recipient: Retry POST
    else Failure (attempt >= 3)
        WebhookService->>DB: status = dead_lettered
        WebhookService->>DB: INSERT into dead_letter_queue
        Note over DB: DLQ entries can be retried via admin API
    end
```

## Observability Stack

```mermaid
graph TD
    REQ[Incoming Request] --> COR[Correlation ID Middleware]
    COR --> LOG[Request Logger]
    LOG --> MET[Metrics Collector]

    LOG -->|structured JSON| STDOUT[stdout/stderr]
    LOG -->|in-memory buffer| LOGAPI[GET /admin/logs]

    MET -->|counters + histograms| METAPI[GET /admin/metrics]

    subgraph "Per Request"
        COR -.- X1[X-Request-ID header]
        LOG -.- X2[method, path, status, duration]
        MET -.- X3[http_requests_total, duration_ms]
    end

    subgraph "Per Saga"
        SAGA[Saga Logger] -.- X4[paymentId, sagaId, step, outcome]
        SAGA --> METRICS2[saga_duration_ms, payments_completed/failed]
    end
```

# Architecture

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

Each step implements `execute()` and `compensate()`. On failure at step N, the orchestrator calls `compensate()` on steps N-1 through 0 in reverse order. Saga state is persisted to `saga_executions` before and after each step, so the process can be recovered after a crash.

## Event Sourcing Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant EventStore
    participant DB

    Client->>API: POST /payments
    API->>EventStore: append(PaymentInitiated, v1)
    EventStore->>DB: INSERT with unique(aggregate_id, version)
    Note over DB: Optimistic lock via unique constraint

    API->>EventStore: append(PaymentValidated, v2)
    API->>EventStore: append(InventoryReserved, v3)
    API->>EventStore: append(PaymentCharged, v4)
    API->>EventStore: append(PaymentCompleted, v5)

    Client->>API: GET /payments/:id
    API->>EventStore: getByAggregateId(id)
    EventStore->>DB: SELECT ... ORDER BY version ASC
    EventStore-->>API: [event1, event2, ..., eventN]
    Note over API: Reduce events through paymentReducer
    API-->>Client: Current PaymentState
```

Payment state is never stored as a mutable row. Instead, the current state is computed by replaying the event log through a pure reducer function (`fullPaymentReducer`). This provides:

- Complete audit trail of every state change
- Ability to replay and debug any payment issue
- Optimistic locking via the unique `(aggregate_id, version)` constraint

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

Configuration:
- **Failure threshold**: Number of consecutive failures to open the circuit (default: 5)
- **Timeout**: Base time before attempting half-open (default: 30s)
- **Backoff**: Exponential with jitter, capped at 2^5 * base timeout

Each external service (payment provider, inventory, notifications) has its own circuit breaker instance.

## Webhook Delivery + Dead Letter Queue

```mermaid
sequenceDiagram
    participant PaymentService
    participant WebhookService
    participant DB
    participant Recipient

    PaymentService->>WebhookService: dispatch(eventType, payload)
    WebhookService->>DB: Find matching registrations
    WebhookService->>DB: Create delivery record (status: pending)

    WebhookService->>WebhookService: Sign payload with HMAC-SHA256
    WebhookService->>Recipient: POST with X-Webhook-Signature header

    alt Success (2xx)
        WebhookService->>DB: Update delivery (status: delivered)
    else Failure
        WebhookService->>DB: Update delivery (attempts++, nextRetryAt)
        Note over WebhookService: Backoff: 1s, 2s, 4s

        alt Attempt < 3
            Note over WebhookService: Scheduled for retry via processRetries()
        else Attempt >= 3
            WebhookService->>DB: Update delivery (status: dead_lettered)
            WebhookService->>DB: INSERT into dead_letter_queue
        end
    end
```

Webhook signatures use HMAC-SHA256 with the configured secret. Recipients verify by computing `HMAC-SHA256(body, secret)` and comparing to the `X-Webhook-Signature` header.

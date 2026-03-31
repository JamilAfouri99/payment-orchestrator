# Architecture Decision Records

## ADR-001: PostgreSQL for Event Store

**Status**: Accepted

**Context**: Event sourcing requires an append-only store with strong ordering guarantees. Options include dedicated event stores (EventStoreDB), message brokers (Kafka), or a relational database.

**Decision**: Use PostgreSQL as the event store.

**Rationale**:
- A single database for events, saga state, idempotency keys, and webhook deliveries means one fewer infrastructure dependency, simpler ops, and transactional consistency across all writes.
- PostgreSQL's unique constraint on `(aggregate_id, version)` provides optimistic locking without application-level logic.
- JSONB columns for event payloads give schema flexibility without sacrificing query capability.
- For the throughput profile of a payment system (thousands, not millions of events/second), PostgreSQL performs well. You'd only outgrow it at extreme scale.

**Trade-off**: A dedicated event store (EventStoreDB) offers built-in projections and subscriptions. PostgreSQL requires building those manually. For this scope, the operational simplicity wins.

## ADR-002: Result<T, E> Over Thrown Exceptions

**Status**: Accepted

**Context**: TypeScript's type system doesn't track thrown exceptions. A function that throws is indistinguishable from one that doesn't — callers only discover error paths at runtime.

**Decision**: Use a discriminated union `Result<T, E>` for all business logic error handling. Reserve thrown exceptions for truly unexpected failures (programmer errors, infrastructure crashes).

**Rationale**:
- Type signatures become honest: `Result<PaymentState, PaymentServiceError>` tells the caller exactly what can go wrong.
- Callers are forced to handle errors — you can't accidentally ignore a failure by forgetting a try/catch.
- Error handling becomes data flow, not control flow. Composing results is more predictable than nesting try/catch blocks.
- The `unwrap()` function exists for system boundaries (HTTP handlers) where you need to convert back to exceptions.

**Trade-off**: More verbose than try/catch for simple cases. Every intermediate function must propagate results. This is intentional — explicit error handling is worth the ceremony in a payment system where silent failures cost money.

## ADR-003: HMAC-SHA256 for Webhook Signatures

**Status**: Accepted

**Context**: Webhook recipients need to verify that payloads genuinely came from this system and haven't been tampered with. Options include HMAC, asymmetric signatures (RSA/ECDSA), or mutual TLS.

**Decision**: Use HMAC-SHA256 with a shared secret.

**Rationale**:
- HMAC-SHA256 is the industry standard for webhook verification (used by Stripe, GitHub, Shopify, Twilio).
- Symmetric key signing is computationally cheap — important when dispatching many webhooks concurrently.
- Verification is straightforward for recipients: compute `HMAC-SHA256(body, secret)`, compare to header.
- The `X-Webhook-Signature` header plus `X-Webhook-Timestamp` enables replay attack protection on the recipient side.

**Trade-off**: Asymmetric signatures (ECDSA) would let recipients verify without possessing a secret, eliminating the secret distribution problem. For a system where you control both sides and the secret is configured at registration time, HMAC is simpler and equally secure.

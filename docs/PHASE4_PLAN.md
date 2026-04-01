# Phase 4: Chargeback & Dispute Lifecycle

## Overview

Add a complete dispute management system to the payment orchestration platform. Disputes model the lifecycle of chargebacks, inquiries, retrievals, and pre-arbitration cases filed by cardholders or issuing banks against merchant transactions.

## Data Models

### Dispute

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| tenantId | string | Tenant scope |
| paymentId | string | Original payment aggregate ID |
| merchantAccountId | string | Merchant account reference |
| externalDisputeId | string | PSP-assigned dispute identifier |
| type | enum | chargeback, inquiry, retrieval, pre_arbitration |
| reason | enum | fraudulent, product_not_received, product_unacceptable, duplicate, subscription_canceled, credit_not_processed, general |
| status | enum | needs_response, under_review, won, lost, accepted |
| amount | int | Disputed amount in cents |
| currency | string | Currency code |
| evidenceDueBy | DateTime | Deadline for merchant evidence submission |
| filedAt | DateTime | When dispute was filed |
| respondedAt | DateTime? | When evidence was submitted |
| resolvedAt | DateTime? | When outcome was determined |
| outcome | string? | won, lost, or null (pending) |
| networkReasonCode | string | Simulated Visa/MC reason code |
| metadata | Json | Extensible metadata |

**Indexes**: `[tenantId, paymentId]`, `[tenantId, status]`, `[tenantId, merchantAccountId]`

### DisputeEvidence

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| tenantId | string | Tenant scope |
| disputeId | string | Parent dispute |
| type | enum | receipt, shipping_proof, customer_communication, refund_policy, service_documentation, other |
| description | string | Evidence description |
| content | string | Text content or simulated file reference |
| submittedAt | DateTime | Submission timestamp |

**Indexes**: `[tenantId, disputeId]`

## Dispute State Machine

```
                    ┌──────────────────┐
                    │  needs_response   │
                    └──────┬───────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            │
        ┌───────────┐ ┌──────────┐     │
        │under_review│ │ accepted │     │
        └─────┬─────┘ └──────────┘     │
              │                        │
         ┌────┴────┐                   │
         ▼         ▼                   ▼
    ┌─────────┐ ┌──────┐         (evidence deadline
    │   won   │ │ lost │          passes → auto-lose)
    └─────────┘ └──────┘
```

Valid transitions:
- `needs_response` → `under_review` (evidence submitted)
- `needs_response` → `accepted` (merchant accepts)
- `needs_response` → `lost` (deadline passes)
- `under_review` → `won` (network rules in merchant's favor)
- `under_review` → `lost` (network rules against merchant)

## Network Reason Codes (Simulated)

| Code | Network | Reason |
|------|---------|--------|
| 10.4 | Visa | Fraud — Card-Absent Environment |
| 13.1 | Visa | Merchandise/Services Not Received |
| 13.3 | Visa | Not as Described or Defective |
| 12.6 | Visa | Duplicate Processing |
| 13.6 | Visa | Credit Not Processed |
| 4863 | Mastercard | Cardholder Does Not Recognize |
| 4853 | Mastercard | Goods/Services Not as Described |
| 4837 | Mastercard | No Cardholder Authorization |

## DisputeService Interface

```typescript
interface DisputeService {
  // PSP notification → creates dispute + ledger hold + webhook + event
  receiveDispute(paymentId, reason, amount, type?, merchantAccountId?):
    Promise<Result<Dispute, DisputeError>>

  // Merchant submits evidence before deadline
  submitEvidence(disputeId, evidence[]):
    Promise<Result<Dispute, DisputeError>>

  // Network resolution (simulated)
  resolveDispute(disputeId, outcome: "won" | "lost"):
    Promise<Result<Dispute, DisputeError>>

  // Merchant accepts chargeback without fighting
  acceptDispute(disputeId):
    Promise<Result<Dispute, DisputeError>>

  // Query
  getDispute(disputeId): Promise<Result<Dispute, DisputeError>>
  listDisputes(filters?): Promise<Result<{disputes, total}, DisputeError>>

  // Chargeback rate tracking
  getChargebackRate(merchantAccountId?):
    Promise<Result<ChargebackRate, DisputeError>>

  // Check if new payments should be blocked
  shouldBlockPayments(merchantAccountId?):
    Promise<Result<boolean, DisputeError>>
}
```

## Ledger Integration

### On dispute received (receiveDispute)
- **DEBIT** `merchant_balance` — hold disputed amount
- **CREDIT** `dispute_holds` — new system account for pending disputes
- Transaction type: `chargeback`, idempotency key: `dispute-hold:{disputeId}`

### On dispute won (resolveDispute → won)
- **DEBIT** `dispute_holds` — release the hold
- **CREDIT** `merchant_balance` — restore merchant funds
- Transaction type: `chargeback`, idempotency key: `dispute-won:{disputeId}`

### On dispute lost or accepted
- **DEBIT** `dispute_holds` — clear the hold
- **CREDIT** `provider_settlement` — funds returned to card network
- Transaction type: `chargeback`, idempotency key: `dispute-lost:{disputeId}`

## Chargeback Rate Thresholds

Rolling 120-day window:
- **Rate** = dispute count / total transaction count
- **< 0.65%**: Normal — no action
- **0.65% – 0.89%**: Warning (Visa Standard threshold)
- **0.90% – 0.99%**: Excessive (Visa Excessive threshold)
- **≥ 1.00%**: Critical — block new payments

## Event Types (New)

| Event | Aggregate | Description |
|-------|-----------|-------------|
| DisputeReceived | Dispute | PSP notified us of a dispute |
| DisputeEvidenceSubmitted | Dispute | Merchant submitted evidence |
| DisputeWon | Dispute | Network ruled in merchant's favor |
| DisputeLost | Dispute | Network ruled against merchant |
| DisputeAccepted | Dispute | Merchant accepted the chargeback |

## Webhook Events

- `dispute.created` — on receiveDispute
- `dispute.evidence_submitted` — on submitEvidence
- `dispute.won` — on resolveDispute(won)
- `dispute.lost` — on resolveDispute(lost)
- `dispute.accepted` — on acceptDispute

## REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /admin/disputes | Simulate receiving a dispute from PSP |
| GET | /admin/disputes | List disputes with filters |
| GET | /admin/disputes/:id | Dispute detail with evidence |
| POST | /admin/disputes/:id/evidence | Submit evidence |
| POST | /admin/disputes/:id/resolve | Resolve dispute (win/lose) |
| POST | /admin/disputes/:id/accept | Accept dispute |
| GET | /admin/disputes/chargeback-rate | Chargeback rate with thresholds |

## Dashboard

### Disputes Page (`/disputes`)
- Summary cards: total disputes, needs_response count, won/lost counts, chargeback rate
- Status filter tabs: all, needs_response, under_review, won, lost, accepted
- Dispute table with urgency indicator (days until evidence due)
- "Create Test Dispute" button to simulate PSP notification
- Expandable detail: timeline, evidence list, evidence submission form
- Action buttons: submit evidence, accept dispute, resolve (win/lose)

### Main Dashboard Widget
- Chargeback rate display with circular gauge
- Color-coded threshold bands (green/yellow/orange/red)
- Dispute count in rolling window

## Implementation Order

1. Prisma schema + migration (Dispute, DisputeEvidence)
2. Ledger: add `dispute_holds` system account
3. `src/dispute/dispute-service.ts` — full lifecycle
4. `src/dispute/dispute-service.test.ts` — tests
5. Integrate into `payment-service.ts` (TenantServices + accessor)
6. Admin routes for all 7 endpoints
7. Dashboard API client types + functions
8. Disputes dashboard page
9. Main dashboard chargeback rate widget
10. Shell navigation update + verification

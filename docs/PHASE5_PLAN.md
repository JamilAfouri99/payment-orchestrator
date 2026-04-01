# Phase 5: Split Payments & Payout System

## Overview

Add marketplace split payment capabilities and a complete payout system to the payment orchestrator. This enables multi-party payments where a single transaction is divided among multiple recipients, plus a payout lifecycle for disbursing funds to merchant bank accounts.

## Data Models

### PaymentSplit

```
id              UUID PK
tenantId        FK → tenant
paymentId       string (the payment being split)
recipientType   "merchant" | "platform" | "third_party"
recipientId     string (merchant account ID or identifier)
amount          int (cents)
currency        string
splitType       "fixed" | "percentage"
description     string
status          "pending" | "executed" | "failed"
ledgerTxId      string? (set after execution)
createdAt       timestamp
updatedAt       timestamp

Indexes: (tenantId, paymentId), (tenantId, recipientId)
```

### PayoutAccount

```
id                   UUID PK
tenantId             FK → tenant
merchantAccountId    string
type                 "bank_account" | "wallet"
bankName             string
accountNumberMasked  string (last 4 only)
routingNumber        string (masked)
currency             string
country              string
status               "pending_verification" | "verified" | "disabled"
isDefault            boolean
createdAt            timestamp
updatedAt            timestamp

Indexes: (tenantId, merchantAccountId), (tenantId, status)
```

### Payout

```
id                  UUID PK
tenantId            FK → tenant
merchantAccountId   string
payoutAccountId     string
amount              int (cents)
currency            string
fees                int (cents, default 0)
status              "pending" | "processing" | "in_transit" | "paid" | "failed" | "canceled"
scheduledAt         timestamp?
initiatedAt         timestamp?
arrivedAt           timestamp?
failedAt            timestamp?
failureReason       string?
retryCount          int (default 0)
settlementIds       JSON array of settlement IDs
ledgerTransactionId string?
createdAt           timestamp
updatedAt           timestamp

Indexes: (tenantId, merchantAccountId), (tenantId, status), (tenantId, payoutAccountId)
```

## Ledger Integration

### New System Account

- `merchant_payout` (asset) — tracks funds in transit to merchant bank accounts

### Split Payment Ledger Entries

When `executeSplits()` runs after payment capture:
- For each merchant recipient split:
  - DR `provider_settlement` by split amount
  - CR `merchant_balance` by split amount (per recipient)
- For platform fee split:
  - DR `provider_settlement` by fee amount
  - CR `platform_fees` by fee amount
- Each split gets its own ledger transaction with idempotency key `split:{paymentId}:{splitId}`

### Payout Ledger Entries

When `processPayout()` runs:
- DR `merchant_balance` by payout amount (reduce merchant liability)
- CR `merchant_payout` by payout amount (funds leaving the system)
- Idempotency key: `payout:{payoutId}`

When payout fails:
- Reverse the original: DR `merchant_payout`, CR `merchant_balance`
- Idempotency key: `payout_reversal:{payoutId}`

## Service Interfaces

### SplitPaymentService

```typescript
interface SplitPaymentService {
  configureSplits(paymentId: string, splits: SplitInput[]): Promise<Result<PaymentSplit[], SplitError>>
  executeSplits(paymentId: string): Promise<Result<PaymentSplit[], SplitError>>
  getSplits(paymentId: string): Promise<Result<PaymentSplit[], SplitError>>
  validateSplits(paymentAmount: number, splits: SplitInput[]): Result<void, SplitError>
}
```

**Validation rules:**
- All splits must sum to exactly the payment total
- No negative or zero split amounts
- Percentage splits must sum to exactly 100%
- At least 2 splits required (otherwise no point splitting)
- recipientType + recipientId required for each

**Use cases:**
1. Simple marketplace: 90% seller + 10% platform
2. Multi-vendor: multiple merchant splits + platform fee
3. Tiered fees: different % based on merchant configuration
4. Chained: seller + affiliate + platform

### PayoutService

```typescript
interface PayoutService {
  // Payout accounts
  createPayoutAccount(input: PayoutAccountInput): Promise<Result<PayoutAccount, PayoutError>>
  listPayoutAccounts(merchantAccountId?: string): Promise<Result<PayoutAccount[], PayoutError>>
  getPayoutAccount(id: string): Promise<Result<PayoutAccount, PayoutError>>
  verifyPayoutAccount(id: string): Promise<Result<PayoutAccount, PayoutError>>
  disablePayoutAccount(id: string): Promise<Result<PayoutAccount, PayoutError>>
  setDefaultPayoutAccount(id: string): Promise<Result<PayoutAccount, PayoutError>>

  // Payouts
  schedulePayout(input: SchedulePayoutInput): Promise<Result<Payout, PayoutError>>
  processPayout(id: string): Promise<Result<Payout, PayoutError>>
  cancelPayout(id: string): Promise<Result<Payout, PayoutError>>
  getPayout(id: string): Promise<Result<Payout, PayoutError>>
  listPayouts(filters?: PayoutFilters): Promise<Result<{ payouts: Payout[]; total: number }, PayoutError>>
}
```

**Payout status lifecycle:**
```
pending → processing → in_transit → paid
pending → canceled
processing → failed (retry once automatically, then stays failed)
in_transit → paid
in_transit → failed
```

## Event Types

- `SplitsConfigured` — splits saved for a payment
- `SplitsExecuted` — all splits executed with ledger entries
- `PayoutScheduled` — payout created in pending state
- `PayoutProcessing` — payout initiated
- `PayoutInTransit` — simulated bank transfer started
- `PayoutPaid` — funds arrived
- `PayoutFailed` — payout failed with reason
- `PayoutCanceled` — payout canceled before processing

## Webhook Events

- `split.configured`, `split.executed`
- `payout.scheduled`, `payout.processing`, `payout.in_transit`, `payout.paid`, `payout.failed`, `payout.canceled`

## REST Endpoints

### Split Payments
- `POST /admin/splits` — Configure splits for a payment
- `POST /admin/splits/:paymentId/execute` — Execute configured splits
- `GET /admin/splits/:paymentId` — Get splits for a payment

### Payout Accounts
- `POST /admin/payout-accounts` — Create payout account
- `GET /admin/payout-accounts` — List payout accounts (optional ?merchantAccountId filter)
- `GET /admin/payout-accounts/:id` — Get payout account detail
- `POST /admin/payout-accounts/:id/verify` — Verify payout account
- `POST /admin/payout-accounts/:id/disable` — Disable payout account
- `POST /admin/payout-accounts/:id/default` — Set as default

### Payouts
- `POST /admin/payouts` — Schedule a payout
- `GET /admin/payouts` — List payouts (optional ?status, ?merchantAccountId, ?limit, ?offset)
- `GET /admin/payouts/:id` — Get payout detail
- `POST /admin/payouts/:id/process` — Process a pending payout
- `POST /admin/payouts/:id/cancel` — Cancel a pending payout

## Dashboard Pages

### Payouts Page (`/payouts`)
- Summary cards: total payouts, pending amount, in-transit amount, paid amount
- Status filter tabs: all, pending, processing, in_transit, paid, failed, canceled
- Payout list with status badges, amounts, timing, merchant info
- Detail panel: linked settlements, ledger transaction, timeline
- "Schedule Payout" form: merchant account, amount, payout account

### Payout Accounts Page (`/payout-accounts`)
- List of payout accounts grouped by merchant
- Status badges (pending_verification, verified, disabled)
- Masked bank details
- "Add Payout Account" form
- Verify / disable / set default actions

### Shell Navigation
- Add "Payouts" and "Payout Accounts" nav items after "Settlements"

## Implementation Order

1. Prisma models + migration
2. Ledger: add `merchant_payout` system account
3. SplitPaymentService + tests
4. PayoutService + tests
5. Wire into payment-service.ts
6. Admin routes
7. Dashboard API client
8. Dashboard pages
9. Shell nav + final verification

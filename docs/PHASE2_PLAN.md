# Phase 2: Double-Entry Ledger & Settlement Engine

## Overview

Add a production-grade double-entry accounting ledger and settlement engine to the payment orchestration platform. Every money movement creates exactly two ledger entries (debit + credit). The sum of all debits always equals the sum of all credits.

## Architecture

### New Modules

```
src/
  ledger/
    ledger-service.ts          # Core double-entry posting, balance, statement, reconcile
    ledger-service.test.ts     # Unit tests
  settlement/
    settlement-service.ts      # Calculate, approve, process settlements
    settlement-service.test.ts # Unit tests

dashboard/src/app/
  ledger/page.tsx              # Account balances, entries, reconciliation
  settlements/page.tsx         # Settlement list, detail, generate, CSV export
```

### Data Models

**LedgerAccount** — Named buckets for tracking money:
- `id`, `tenantId`, `type` (asset | liability | revenue | expense)
- `name` (e.g. "merchant_balance", "platform_fees", "provider_settlement", "refund_reserve")
- `currency`, `isSystemAccount` (platform-level vs merchant)
- Balance is NEVER stored — always derived by summing entries

**LedgerEntry** — Individual debit or credit:
- `id`, `tenantId`, `transactionId` (FK to LedgerTransaction)
- `accountId` (FK to LedgerAccount), `direction` (debit | credit)
- `amount` (always positive — direction determines sign)
- `currency`, `effectiveAt`, `postedAt`
- `metadata` (JSON: paymentId, refundId, settlementId, description)

**LedgerTransaction** — Groups entries into an atomic unit:
- `id`, `tenantId`, `type` (payment_captured | refund | settlement | fee | chargeback | adjustment)
- `idempotencyKey` (prevents duplicate postings)
- `status` (pending | posted | reversed)
- `description`, `createdAt`

**Settlement** — Payout calculation for a merchant:
- `id`, `tenantId`, `merchantAccountId`
- `periodStart`, `periodEnd`
- `status` (calculating | pending_approval | approved | processing | settled | failed)
- `grossAmount`, `totalFees`, `totalRefunds`, `totalChargebacks`, `netAmount`
- `currency`, `payoutMethod` (bank_transfer | wallet)
- `scheduledAt`, `settledAt`
- `ledgerTransactionId` (FK to LedgerTransaction when settled)

### Accounting Entries

**Payment Captured** ($100 payment, 3% fee = $3):
```
DEBIT  provider_settlement  $100.00  (asset — PSP owes us)
CREDIT merchant_balance      $97.00  (liability — we owe merchant)
CREDIT platform_fees          $3.00  (revenue — our cut)
```

**Refund** ($100 refund, fee configurable — default: refund fee too):
```
DEBIT  merchant_balance      $97.00  (reduce liability)
CREDIT provider_settlement   $97.00  (reduce asset)
DEBIT  platform_fees          $3.00  (reverse revenue)
CREDIT provider_settlement    $3.00  (reduce asset)
```

**Settlement** (pay merchant $97 balance):
```
DEBIT  merchant_balance      $97.00  (reduce liability — we paid)
CREDIT settled_payouts       $97.00  (track historical payouts)
```

### Integration Points

1. **Payment completion hook** — After saga emits `PaymentCompleted` and state is derived, post a `payment_captured` ledger transaction. Added to `payment-service.ts` after the saga result handling.

2. **Default account seeding** — On first ledger operation for a tenant, create the 4 system accounts: `provider_settlement` (asset), `merchant_balance` (liability), `platform_fees` (revenue), `settled_payouts` (expense).

3. **Settlement flow** — SettlementService queries ledger entries in a date range, aggregates amounts, and creates a settlement record. Processing the settlement creates a ledger transaction moving money from `merchant_balance` to `settled_payouts`.

4. **Reconciliation** — Periodic integrity check: sum(debits) === sum(credits) globally, no orphaned entries, correct entry counts per transaction.

### API Endpoints

**Ledger:**
| Method | Path | Purpose |
|--------|------|---------|
| GET | /admin/ledger/accounts | List all ledger accounts with computed balances |
| GET | /admin/ledger/accounts/:id/balance | Balance at point in time (?asOf=) |
| GET | /admin/ledger/accounts/:id/statement | Entries in date range (?from=&to=) |
| GET | /admin/ledger/transactions | List ledger transactions |
| GET | /admin/ledger/transactions/:id | Transaction detail with entries |
| POST | /admin/ledger/reconcile | Run reconciliation check |

**Settlements:**
| Method | Path | Purpose |
|--------|------|---------|
| GET | /admin/settlements | List settlements |
| POST | /admin/settlements/calculate | Generate settlement for period |
| GET | /admin/settlements/:id | Settlement detail |
| POST | /admin/settlements/:id/approve | Approve settlement (finance role) |
| POST | /admin/settlements/:id/process | Process settlement (create ledger entries) |
| GET | /admin/settlements/:id/report | Detailed breakdown |
| GET | /admin/settlements/:id/export | CSV export |

### Dashboard Pages

**Ledger page** (`/ledger`):
- Account cards showing current balance per account
- Transaction log with debit/credit color coding
- Click-through to account statement with date range picker
- Reconciliation status panel (last run, pass/fail, discrepancy count)

**Settlements page** (`/settlements`):
- Settlement list with status badges (color-coded by status)
- "Generate Settlement" button with date range picker
- Settlement detail drill-down showing line-by-line breakdown
- CSV export button
- Approval/process action buttons

### Implementation Order

1. Prisma schema + migration (4 new models)
2. LedgerService + tests
3. SettlementService + tests
4. Integration with payment-service (auto-post on payment complete)
5. Admin routes
6. Dashboard API functions
7. Dashboard Ledger page
8. Dashboard Settlements page
9. Shell navigation update
10. Type check + test run

### Fee Configuration

Platform fee rate: 300 basis points (3%) — stored as a constant in ledger-service.ts (`PLATFORM_FEE_BPS = 300`). Configurable per-tenant in a future phase.

### Idempotency

Every ledger transaction has an `idempotencyKey`. For payment captures, this is `payment_captured:${paymentId}`. Duplicate posts are silently ignored (return existing transaction).

### Integrity Invariants

1. Sum of all debit amounts === sum of all credit amounts (global)
2. Every LedgerTransaction has entries summing to zero (debits - credits = 0)
3. No orphaned LedgerEntry records (every entry belongs to a transaction)
4. No account with negative balance unless explicitly allowed (refund_reserve)
5. All amounts are positive integers (cents) — direction determines sign

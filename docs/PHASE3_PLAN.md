# Phase 3: Subscription Billing, Invoice Generation & Dunning

## Overview

Adds recurring billing infrastructure to the payment orchestrator: subscription plans with lifecycle management, automated invoice generation with payment collection, and a smart dunning engine for failed payment recovery.

## Data Models

### Plan
| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| tenantId | string | Tenant scope |
| name | string | Display name |
| description | string | Plan description |
| billingInterval | enum | daily, weekly, monthly, yearly |
| amount | int | In cents |
| currency | string | 3-letter ISO |
| trialDays | int | 0 = no trial |
| features | JSON | Feature flag list |
| status | enum | active, archived |
| metadata | JSON | Extensible |

### Subscription
| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| tenantId | string | Tenant scope |
| customerId | string | Customer reference |
| planId | string | FK to Plan |
| status | enum | trialing, active, past_due, paused, canceled, expired |
| currentPeriodStart | DateTime | Current billing period start |
| currentPeriodEnd | DateTime | Current billing period end |
| trialStart | DateTime? | Trial start (null if no trial) |
| trialEnd | DateTime? | Trial end |
| canceledAt | DateTime? | When canceled |
| cancelReason | string? | Cancellation reason |
| paymentMethodTokenId | string? | Reference to tokenization vault |
| nextBillingDate | DateTime | Next charge date |
| quantity | int | Per-seat billing (default 1) |
| metadata | JSON | Extensible |

### Invoice
| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| tenantId | string | Tenant scope |
| subscriptionId | string | FK to Subscription |
| customerId | string | Customer reference |
| status | enum | draft, open, paid, past_due, void, uncollectible |
| lineItems | JSON | Array of { description, quantity, unitAmount, amount, periodStart, periodEnd } |
| subtotal | int | Sum of line items |
| taxAmount | int | Tax in cents |
| taxRate | int | Tax rate in basis points |
| total | int | subtotal + taxAmount |
| currency | string | 3-letter ISO |
| dueDate | DateTime | Payment due date |
| paidAt | DateTime? | When paid |
| paymentId | string? | FK to payment that settled this |
| attemptCount | int | Number of payment attempts |
| nextAttemptAt | DateTime? | Next retry time |
| hostedInvoiceUrl | string | Simulated hosted URL |
| pdfUrl | string | Simulated PDF URL |

### DunningConfig
| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| tenantId | string | Unique per tenant |
| maxRetryAttempts | int | Default 4 |
| retryScheduleDays | JSON | Default [1, 3, 5, 7] |
| onFirstFailure | string | email_customer or none |
| onEachRetry | string | email_customer or none |
| onFinalFailure | string | cancel_subscription, pause_subscription, or mark_unpaid |
| gracePeriodDays | int | Days to keep service active while retrying |

## Subscription State Machine

```
trialing ──→ active (trial ends, payment succeeds)
trialing ──→ canceled (user cancels during trial)
active ────→ past_due (payment fails)
active ────→ paused (user pauses)
active ────→ canceled (user/admin cancels)
past_due ──→ active (retry succeeds)
past_due ──→ canceled (max retries exhausted)
paused ────→ active (user resumes)
```

Every state transition appends an event to the event store with aggregateType "Subscription".

## Event Types (new)

- `SubscriptionCreated` — initial creation
- `SubscriptionTrialStarted` — trial period begins
- `SubscriptionActivated` — first payment or trial→active
- `SubscriptionPaymentFailed` — payment attempt failed
- `SubscriptionPastDue` — marked past_due
- `SubscriptionPaused` — user paused
- `SubscriptionResumed` — user resumed from pause
- `SubscriptionCanceled` — canceled (with reason)
- `SubscriptionUpgraded` — plan changed mid-cycle (with proration)
- `SubscriptionDowngraded` — plan change scheduled for next cycle
- `InvoiceGenerated` — new invoice created
- `InvoicePaymentAttempted` — payment attempt made
- `InvoicePaid` — invoice settled
- `InvoiceVoided` — invoice voided
- `InvoiceMarkedUncollectible` — dunning exhausted
- `DunningStarted` — first failure, dunning flow begins
- `DunningRetryScheduled` — retry scheduled
- `DunningRetryAttempted` — retry executed
- `DunningRecovered` — payment succeeded during dunning
- `DunningExhausted` — all retries failed

## Services

### SubscriptionService
Factory: `createSubscriptionService(prisma, tenantId, eventStore, ledgerService)`

Methods:
- `createPlan(input)` — create a billing plan
- `getPlan(id)` — get plan by ID
- `listPlans()` — list all active plans
- `archivePlan(id)` — soft-delete a plan
- `create(customerId, planId, paymentMethodTokenId, quantity?)` — create subscription, start trial or first billing
- `get(id)` — get subscription with computed fields
- `list(filters?)` — list with status filter
- `cancel(id, reason, immediate?)` — cancel at period end or immediately with proration
- `upgrade(id, newPlanId)` — prorate and switch mid-cycle
- `downgrade(id, newPlanId)` — schedule for next billing cycle
- `pause(id)` — pause billing
- `resume(id)` — resume from pause
- `getUpcomingInvoice(id)` — preview next invoice

### BillingEngine
Factory: `createBillingEngine(prisma, tenantId, subscriptionService, ledgerService, eventStore)`

Methods:
- `processDueSubscriptions()` — find subscriptions where nextBillingDate <= now, generate invoices, attempt payment
- `generateInvoice(subscriptionId)` — create invoice with line items
- `attemptPayment(invoiceId)` — charge via saved payment method
- `getInvoice(id)` — get invoice by ID
- `listInvoices(filters?)` — list with status/subscription filters
- `voidInvoice(id)` — void an unpaid invoice
- `getInvoiceUrl(id)` — simulated hosted URL

### DunningService
Factory: `createDunningService(prisma, tenantId, billingEngine, subscriptionService, eventStore)`

Methods:
- `getConfig()` — get tenant dunning config (creates default if missing)
- `updateConfig(config)` — update dunning settings
- `startDunning(invoiceId)` — begin dunning flow for failed invoice
- `processRetries()` — process all due retries
- `getActiveDunningFlows()` — list active dunning subscriptions
- `getRetryAnalytics()` — success rates by hour/day for smart scheduling
- `scheduleSmartRetry(invoiceId)` — schedule retry at optimal time

## Proration Engine

When upgrading mid-cycle:
1. Calculate days remaining in current period
2. Credit = (daysRemaining / totalDays) * oldPlanAmount
3. Charge = (daysRemaining / totalDays) * newPlanAmount
4. Net = Charge - Credit
5. If Net > 0: create prorated invoice
6. If Net <= 0: apply credit to next invoice
7. Post ledger adjustment entry

## Ledger Integration

### Invoice Payment
- DR provider_settlement (amount)
- CR merchant_balance (amount - platformFee)
- CR platform_fees (platformFee)

### Invoice Write-Off (dunning exhausted)
- DR bad_debt (amount) — new system account
- CR merchant_balance (amount)

### Proration Adjustment
- DR/CR subscription_adjustments — new system account

## API Endpoints

### Subscription Plans
| Method | Path | Purpose |
|--------|------|---------|
| POST | /admin/subscriptions/plans | Create plan |
| GET | /admin/subscriptions/plans | List plans |
| GET | /admin/subscriptions/plans/:id | Get plan |
| DELETE | /admin/subscriptions/plans/:id | Archive plan |

### Subscriptions
| Method | Path | Purpose |
|--------|------|---------|
| POST | /admin/subscriptions | Create subscription |
| GET | /admin/subscriptions | List subscriptions (with status filter) |
| GET | /admin/subscriptions/:id | Get subscription detail |
| POST | /admin/subscriptions/:id/cancel | Cancel subscription |
| POST | /admin/subscriptions/:id/upgrade | Upgrade plan |
| POST | /admin/subscriptions/:id/downgrade | Downgrade plan |
| POST | /admin/subscriptions/:id/pause | Pause subscription |
| POST | /admin/subscriptions/:id/resume | Resume subscription |
| GET | /admin/subscriptions/:id/upcoming-invoice | Preview next invoice |
| GET | /admin/subscriptions/:id/events | Event history |

### Invoices
| Method | Path | Purpose |
|--------|------|---------|
| GET | /admin/invoices | List invoices (with status filter) |
| GET | /admin/invoices/:id | Get invoice |
| POST | /admin/invoices/:id/pay | Attempt payment |
| POST | /admin/invoices/:id/void | Void invoice |
| POST | /admin/billing/process | Trigger billing cycle |

### Dunning
| Method | Path | Purpose |
|--------|------|---------|
| GET | /admin/dunning/config | Get dunning config |
| PUT | /admin/dunning/config | Update dunning config |
| GET | /admin/dunning/active | List active dunning flows |
| POST | /admin/dunning/process | Process due retries |
| GET | /admin/dunning/analytics | Retry success analytics |

## Dashboard Pages

### Subscriptions Page (`/subscriptions`)
- Summary cards: active count, trialing count, MRR, churn rate
- Filter tabs: all, trialing, active, past_due, paused, canceled
- Subscription table with status badges, plan name, next billing date
- Click to detail view: full lifecycle timeline, upcoming invoice preview, payment method, plan info
- Action buttons: cancel, pause/resume, upgrade/downgrade

### Invoices Page (`/invoices`)
- Summary cards: outstanding amount, paid this month, overdue count
- Filter tabs: all, draft, open, paid, past_due, void
- Invoice table with status badges, amount, due date, attempt count
- Action buttons: pay, void, retry

### Dunning Page (`/dunning`)
- Recovery rate metric (large display)
- Active dunning flows table: subscription, invoice, attempts, next retry, status
- Retry analytics chart: success rate by hour-of-day and day-of-week
- Dunning config editor

## Implementation Order

1. Prisma models + migration
2. SubscriptionService (state machine + event sourcing + proration)
3. BillingEngine (invoice generation + payment attempts)
4. DunningService (retry scheduling + smart retry + analytics)
5. Tests for all three services
6. Wire into PaymentService + admin routes + main.ts
7. Dashboard API client functions
8. Dashboard pages (subscriptions, invoices, dunning)
9. Type check + test verification

## New System Accounts

Added to SYSTEM_ACCOUNTS in ledger-service:
- `bad_debt` (expense) — write-offs from uncollectible invoices
- `subscription_adjustments` (revenue) — proration credits/charges

## New Constants

- `BILLING_CHECK_INTERVAL_MS = 3_600_000` (1 hour)
- `DEFAULT_TAX_RATE_BPS = 0` (no tax by default)
- `DEFAULT_MAX_RETRY_ATTEMPTS = 4`
- `DEFAULT_RETRY_SCHEDULE_DAYS = [1, 3, 5, 7]`
- `DEFAULT_GRACE_PERIOD_DAYS = 7`

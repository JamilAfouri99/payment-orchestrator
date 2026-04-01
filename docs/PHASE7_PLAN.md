# Phase 7: 3D Secure, Alternative Payment Methods & Embeddable Checkout

## Overview

This phase adds three interconnected capabilities:
- **7A**: 3D Secure simulation (PSD2/SCA compliance modeling)
- **7B**: Alternative payment methods beyond cards (bank transfers, wallets, BNPL, crypto)
- **7C**: Embeddable checkout sessions with hosted payment form

## Data Models

### ThreeDSecure
```
id              String    @id @default(uuid())
tenantId        String
paymentId       String
version         String    // "3ds1" | "3ds2"
status          String    // challenge_required, frictionless, authenticated, failed, attempted
eci             String    // "05" (fully authenticated), "06" (attempted/3DS1), "07" (non-3DS)
cavv            String    // simulated authentication value
dsTransId       String    // directory server transaction ID
challengeUrl    String    // simulated redirect URL
liabilityShift  Boolean   @default(false)
completedAt     DateTime?
createdAt       DateTime  @default(now())

@@index([tenantId, paymentId])
```

### PaymentMethod
```
id              String    @id @default(uuid())
tenantId        String
customerId      String
type            String    // card, bank_transfer, wallet, bnpl, crypto
status          String    // active, expired, revoked
// Card fields
cardBrand       String?
cardLast4       String?
cardExpMonth    Int?
cardExpYear     Int?
cardFunding     String?   // credit, debit, prepaid
// Bank transfer fields
bankName        String?
bankLast4       String?
bankType        String?   // ach, sepa, wire
// Wallet fields
walletProvider  String?   // apple_pay, google_pay, paypal
walletEmail     String?
// BNPL fields
bnplProvider    String?   // klarna, afterpay, affirm
bnplInstallments Int?
// Crypto fields
cryptoChain     String?   // ethereum, bitcoin, solana
cryptoCurrency  String?   // BTC, ETH, USDC
cryptoAddress   String?
// Common
label           String    @default("")
isDefault       Boolean   @default(false)
metadata        Json      @default("{}")
createdAt       DateTime  @default(now())
updatedAt       DateTime  @updatedAt

@@index([tenantId, customerId])
@@index([tenantId, type])
```

### CheckoutSession
```
id                    String    @id @default(uuid())
tenantId              String
merchantAccountId     String    @default("default")
amount                Int       // cents
currency              String    @default("USD")
description           String    @default("")
lineItems             Json      @default("[]")   // [{name, quantity, unitPrice}]
customer              Json      @default("{}")    // {email, name, billingAddress}
allowedPaymentMethods Json      @default("[\"card\"]")
successUrl            String    @default("")
cancelUrl             String    @default("")
expiresAt             DateTime
status                String    @default("open") // open, complete, expired
paymentId             String?
paymentMethodType     String?
metadata              Json      @default("{}")
createdAt             DateTime  @default(now())
updatedAt             DateTime  @updatedAt

@@index([tenantId, status])
@@index([tenantId, merchantAccountId])
```

## 7A: 3D Secure Service

### Service Interface (`src/three-d-secure/three-d-secure-service.ts`)

```typescript
interface ThreeDSecureService {
  initiate(paymentId: string, params: ThreeDSecureParams): Promise<Result<ThreeDSecureRecord, ThreeDSecureError>>;
  complete(threeDSecureId: string, outcome: "authenticated" | "failed"): Promise<Result<ThreeDSecureRecord, ThreeDSecureError>>;
  check(paymentId: string): Promise<Result<ThreeDSecureRecord | null, ThreeDSecureError>>;
  shouldRequire(params: ThreeDSecureCheckParams): boolean;
}
```

### 3DS Decision Logic

| Condition | 3DS Required | ECI |
|-----------|-------------|-----|
| EU card (PSD2/SCA) | Always | 05 |
| Fraud score > 60 | Always | 05 |
| Amount >= 10000 (100 EUR) | Sometimes (50%) | 05/06 |
| Amount < 3000 (30 EUR) | Never (low-value exemption) | 07 |
| Trusted beneficiary flag | Never | 07 |
| Default | Sometimes (20%) | 05/06 |

### Simulated Flow
1. `shouldRequire()` determines if 3DS is needed
2. `initiate()` creates record with `challenge_required` status, generates challenge URL
3. Client simulates redirect (auto-completes)
4. `complete()` updates status to `authenticated` or `failed`, sets ECI + CAVV
5. If authenticated (eci=05): liability shifts to issuer, tracked on payment

### Event Types
- `ThreeDSecureInitiated` — 3DS challenge created
- `ThreeDSecureCompleted` — authentication result recorded
- `ThreeDSecureFailed` — authentication failed

## 7B: Alternative Payment Methods Service

### Service Interface (`src/payment-methods/payment-method-service.ts`)

```typescript
interface PaymentMethodService {
  create(input: CreatePaymentMethodInput): Promise<Result<PaymentMethodRecord, PaymentMethodError>>;
  get(id: string): Promise<Result<PaymentMethodRecord, PaymentMethodError>>;
  listByCustomer(customerId: string): Promise<Result<PaymentMethodRecord[], PaymentMethodError>>;
  setDefault(customerId: string, id: string): Promise<Result<PaymentMethodRecord, PaymentMethodError>>;
  revoke(id: string): Promise<Result<void, PaymentMethodError>>;
  checkEligibility(type: string, amount: number, currency: string): Result<EligibilityResult, PaymentMethodError>;
  getSupportedMethods(currency: string, country?: string): PaymentMethodCapability[];
}
```

### Payment Method Capabilities

| Type | Currencies | Amount Range | Countries |
|------|-----------|-------------|-----------|
| card | All | $0.50-$999,999 | All |
| bank_transfer (ACH) | USD | $1-$100,000 | US |
| bank_transfer (SEPA) | EUR | 1-100,000 EUR | EU |
| wallet (Apple Pay) | USD, EUR, GBP | $0.50-$25,000 | US, EU, GB |
| wallet (Google Pay) | USD, EUR, GBP | $0.50-$25,000 | US, EU, GB |
| wallet (PayPal) | USD, EUR, GBP | $1-$10,000 | US, EU, GB |
| bnpl (Klarna) | USD, EUR, GBP | $50-$1,000 | US, EU, GB |
| bnpl (Afterpay) | USD, AUD | $50-$1,000 | US, AU |
| bnpl (Affirm) | USD | $50-$5,000 | US |
| crypto (BTC) | BTC | 0.0001-10 BTC | All |
| crypto (ETH) | ETH | 0.001-100 ETH | All |
| crypto (USDC) | USDC | $1-$50,000 | All |

### BNPL Installment Plans
- $50-$250: 4 installments
- $250-$500: 6 installments
- $500-$1000: 12 installments
- $1000-$5000: 24 installments (Affirm only)

### Event Types
- `PaymentMethodCreated` — new payment method stored

## 7C: Checkout Session Service

### Service Interface (`src/checkout/checkout-service.ts`)

```typescript
interface CheckoutService {
  createSession(input: CreateSessionInput): Promise<Result<CheckoutSessionRecord, CheckoutError>>;
  getSession(sessionId: string): Promise<Result<CheckoutSessionRecord, CheckoutError>>;
  completeSession(sessionId: string, paymentId: string, paymentMethodType: string): Promise<Result<CheckoutSessionRecord, CheckoutError>>;
  expireSession(sessionId: string): Promise<Result<void, CheckoutError>>;
  listSessions(params?: { status?: string; limit?: number }): Promise<Result<CheckoutSessionRecord[], CheckoutError>>;
  getConversionStats(): Promise<Result<ConversionStats, CheckoutError>>;
}
```

### Session Lifecycle
1. `POST /checkout/sessions` creates session with 30-min TTL → returns `{sessionId, checkoutUrl}`
2. Customer visits checkout URL (hosted page in dashboard)
3. Customer selects payment method, enters details
4. Card validation: Luhn check, expiry future, CVV 3-4 digits
5. "Pay" button calls `POST /checkout/sessions/:id/complete` → creates payment via payment service
6. Redirect to `successUrl` or `cancelUrl`
7. Background: expire sessions past `expiresAt`

### Checkout URL Format
`/checkout/:sessionId` — hosted in the dashboard app

### Conversion Analytics
- Sessions created vs completed (conversion rate)
- Average time to complete
- Drop-off by payment method
- Expiration rate

### Event Types
- `CheckoutSessionCreated` — session opened
- `CheckoutSessionCompleted` — payment collected

## REST Endpoints

### 3D Secure (4 endpoints)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/admin/3ds/initiate` | Initiate 3DS for a payment |
| POST | `/admin/3ds/:id/complete` | Complete 3DS authentication |
| GET | `/admin/3ds/payment/:paymentId` | Get 3DS record for payment |
| POST | `/admin/3ds/check` | Check if 3DS would be required |

### Payment Methods (6 endpoints)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/admin/payment-methods` | Create payment method |
| GET | `/admin/payment-methods` | List by customer |
| GET | `/admin/payment-methods/:id` | Get specific method |
| POST | `/admin/payment-methods/:id/default` | Set as default |
| POST | `/admin/payment-methods/:id/revoke` | Revoke method |
| GET | `/admin/payment-methods/supported` | List supported methods for currency/country |

### Checkout Sessions (6 endpoints)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/checkout/sessions` | Create checkout session |
| GET | `/checkout/sessions` | List sessions |
| GET | `/checkout/sessions/:id` | Get session details |
| POST | `/checkout/sessions/:id/complete` | Complete with payment |
| POST | `/checkout/sessions/:id/expire` | Force expire |
| GET | `/checkout/analytics` | Conversion stats |

## Dashboard Pages

### Checkout Page (`/checkout`)
- **Configuration panel**: branding colors, allowed payment methods, default currency
- **Session management**: create test sessions, view active/completed/expired
- **Conversion analytics**: created vs completed rate, avg completion time, method breakdown
- **Checkout preview**: live preview of the embedded checkout form

### Hosted Checkout Page (`/checkout/:sessionId`)
- Responsive payment form
- Line items and amount display
- Payment method selector (card, bank, wallet, BNPL based on session config)
- Card input with Luhn validation, expiry check, CVV format
- Loading states and error handling
- Success/failure redirect

## Files to Create/Modify

### New Files
- `src/three-d-secure/three-d-secure-service.ts`
- `src/three-d-secure/three-d-secure-service.test.ts`
- `src/payment-methods/payment-method-service.ts`
- `src/payment-methods/payment-method-service.test.ts`
- `src/checkout/checkout-service.ts`
- `src/checkout/checkout-service.test.ts`
- `prisma/migrations/20240110000000_3ds_apm_checkout/migration.sql`
- `dashboard/src/app/checkout/page.tsx`
- `dashboard/src/app/checkout/[sessionId]/page.tsx`

### Modified Files
- `prisma/schema.prisma` — 3 new models
- `src/core/types.ts` — 6 new event types
- `src/api/payment-service.ts` — wire 3 new services
- `src/api/admin-routes.ts` — 16 new endpoints
- `dashboard/src/lib/api.ts` — new types + fetch functions
- `dashboard/src/app/shell.tsx` — add Checkout nav item

## Testing Plan

| Service | Test Count (est.) | Key Scenarios |
|---------|------------------|---------------|
| 3DS | ~15 | shouldRequire logic, initiate, complete, liability shift, ECI codes |
| Payment Methods | ~18 | CRUD, eligibility by type/currency/amount, BNPL installments, supported methods |
| Checkout | ~14 | Session lifecycle, expiry, completion, conversion stats, validation |
| **Total** | ~47 | |

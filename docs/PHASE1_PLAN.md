# Phase 1: Multi-Tenant SaaS Transformation

## Current State

- 48 backend source files, 15 test files (207 tests), 13 dashboard pages
- 12 Prisma models — **none have tenantId** (single-tenant)
- **No authentication** — all endpoints are public
- **No authorization** — no users, roles, or permissions
- **No tenant isolation** — all data is globally accessible
- Every `findMany`, `count`, `findUnique` query across all 12 models lacks tenant scoping

## Scope

| Feature | New Backend Files | New Dashboard Pages | New Prisma Models | New Tests |
|---------|------------------|--------------------|--------------------|-----------|
| 1A: Tenant & Merchant Data Model | 3 | 0 | 3 (Tenant, MerchantAccount, + tenantId on all 12 existing) | ~15 |
| 1B: API Key Management | 3 | 1 (/settings/api-keys) | 1 (ApiKey) | ~12 |
| 1C: Merchant Onboarding | 3 | 1 (/onboarding) | 2 (KybApplication, User) | ~10 |
| 1D: RBAC & Team Dashboard | 3 | 2 (/settings/team, /login) | 2 (TeamMember, InviteToken) | ~12 |
| **Total** | **~12** | **~4** | **8 new models** | **~49** |

---

## 1A: Tenant & Merchant Data Model

### New Prisma Models

```prisma
model Tenant {
  id              String   @id @default(uuid())
  name            String
  slug            String   @unique
  status          String   @default("onboarding") // onboarding, active, suspended
  plan            String   @default("free")        // free, starter, growth, enterprise
  defaultCurrency String   @default("USD") @map("default_currency")
  timezone        String   @default("UTC")
  webhookSecret   String   @map("webhook_secret")
  trialExpiresAt  DateTime? @map("trial_expires_at")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("tenants")
}

model MerchantAccount {
  id                 String   @id @default(uuid())
  tenantId           String   @map("tenant_id")
  name               String
  environment        String   @default("sandbox") // sandbox, production
  status             String   @default("active")   // active, suspended, closed
  mcc                String?                        // Merchant Category Code
  businessType       String?  @map("business_type")
  riskTier           String   @default("medium") @map("risk_tier") // low, medium, high
  settlementCurrency String   @default("USD") @map("settlement_currency")
  payoutSchedule     String   @default("weekly") @map("payout_schedule") // daily, weekly, monthly
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  @@index([tenantId])
  @@map("merchant_accounts")
}
```

### Adding tenantId to All 12 Existing Models

Every existing model gets a new required `tenantId String @map("tenant_id")` field with an index. Unique constraints that are currently on a single field become composite:

| Model | Current Unique | New Unique | Notes |
|-------|---------------|------------|-------|
| `EventStore` | `@@unique([aggregateId, version])` | `@@unique([tenantId, aggregateId, version])` | Optimistic locking scoped per tenant |
| `EventSnapshot` | `aggregateId @unique` | `@@unique([tenantId, aggregateId])` | Snapshot lookup per tenant |
| `IdempotencyKey` | `key @unique` | `@@unique([tenantId, key])` | Prevents cross-tenant key collision |
| `PaymentToken` | `token @unique` | stays `token @unique` (tokens are globally unique UUIDs) | But all queries add `tenantId` filter |
| All others | No unique constraints affected | Just add `tenantId` + `@@index([tenantId])` | |

### Tenant Context Pattern

Instead of modifying every factory function signature, introduce a `TenantContext` that flows through the request:

```typescript
// src/tenancy/tenant-context.ts
export interface TenantContext {
  tenantId: string;
  merchantAccountId?: string | undefined;
  environment: "sandbox" | "production";
  plan: string;
}
```

The auth middleware (1B) populates this. All service factories accept it. This avoids changing every method signature — the context travels implicitly.

### New Backend Files

| File | Purpose |
|------|---------|
| `src/tenancy/tenant-context.ts` | TenantContext interface and AsyncLocalStorage holder |
| `src/tenancy/tenant-service.ts` | CRUD for Tenant and MerchantAccount |
| `src/tenancy/tenant-scoping.ts` | Helper to inject tenantId into Prisma queries; wraps PrismaClient with scoped proxy |

### Tenant-Scoped Prisma Proxy

Rather than editing 50+ queries across 12 files manually, create a Prisma proxy that auto-injects `tenantId`:

```typescript
// src/tenancy/tenant-scoping.ts
export function createTenantScopedPrisma(prisma: PrismaClient, tenantId: string) {
  // Returns a proxy that intercepts findMany/findFirst/count/create/update/delete
  // and automatically adds { where: { tenantId } } to reads
  // and { data: { tenantId } } to creates
}
```

This is the key architectural decision: instead of threading `tenantId` through 48 source files, the scoped Prisma client handles it transparently. Existing code reads `prisma.eventStore.findMany({ where: { aggregateId } })` and the proxy ensures `tenantId` is always injected.

**Tradeoff**: Proxy adds a layer of indirection. But the alternative — manually editing every query in event-store.ts, fraud-engine.ts, token-vault.ts, webhook-delivery.ts, provider-metrics.ts, idempotency-middleware.ts, saga-orchestrator.ts, and admin-routes.ts — is ~200 line changes with high risk of missing one (data leak).

### Migration Strategy

The migration must handle existing data (from the demo). We'll assign all existing records to a default "demo" tenant:

```sql
-- Add tenantId column with default, then make NOT NULL
ALTER TABLE event_store ADD COLUMN tenant_id TEXT;
UPDATE event_store SET tenant_id = 'demo-tenant-id' WHERE tenant_id IS NULL;
ALTER TABLE event_store ALTER COLUMN tenant_id SET NOT NULL;
-- Repeat for all 12 tables
-- Then create the new unique constraints
```

### Tests

| File | Scope |
|------|-------|
| `src/tenancy/tenant-service.test.ts` | Tenant CRUD, merchant account CRUD, slug uniqueness |
| `src/tenancy/tenant-scoping.test.ts` | Prisma proxy injects tenantId correctly, cross-tenant isolation |

---

## 1B: API Key Management

### New Prisma Model

```prisma
model ApiKey {
  id                String    @id @default(uuid())
  tenantId          String    @map("tenant_id")
  merchantAccountId String?   @map("merchant_account_id")
  keyPrefix         String    @map("key_prefix")        // "pk_live_" or "pk_test_"
  keyHash           String    @map("key_hash")           // bcrypt hash
  environment       String                               // sandbox, production
  permissions       Json      @default("[\"payments:read\",\"payments:write\"]")
  status            String    @default("active")         // active, revoked, expired
  name              String    @default("")               // user-given label
  expiresAt         DateTime? @map("expires_at")
  lastUsedAt        DateTime? @map("last_used_at")
  lastUsedIp        String?   @map("last_used_ip")
  rateLimitMax      Int       @default(1000) @map("rate_limit_max")
  rateLimitWindowS  Int       @default(60) @map("rate_limit_window_s")
  createdBy         String?   @map("created_by")
  revokedBy         String?   @map("revoked_by")
  revokedAt         DateTime? @map("revoked_at")
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  @@index([tenantId])
  @@index([keyPrefix])
  @@index([status])
  @@map("api_keys")
}
```

### Key Generation

```typescript
// src/auth/api-key-service.ts
export interface ApiKeyService {
  generate(tenantId: string, opts: GenerateOpts): Promise<Result<{ key: string; record: ApiKeyRecord }, ApiKeyError>>;
  validate(rawKey: string): Promise<Result<ValidatedKey, ApiKeyError>>;
  revoke(keyId: string, revokedBy: string): Promise<Result<void, ApiKeyError>>;
  listByTenant(tenantId: string): Promise<Result<ApiKeyRecord[], ApiKeyError>>;
  updateLastUsed(keyId: string, ip: string): Promise<void>;
}
```

**Generation flow**:
1. Prefix: `pk_live_` (production) or `pk_test_` (sandbox)
2. Random: 32 bytes → base62 encoding (alphanumeric, no special chars)
3. Full key: `pk_live_a1B2c3D4...` (~52 chars total)
4. Store: `bcrypt(fullKey)` as `keyHash`, first 12 chars as `keyPrefix`
5. Return full key in response — never stored or retrievable again

**Validation flow** (in middleware):
1. Extract from `Authorization: Bearer pk_live_xxx`
2. Extract prefix (first 8 chars) → query DB for matching active keys with that prefix
3. For each candidate, `bcrypt.compare(rawKey, keyHash)` — first match wins
4. Check `status === "active"`, `expiresAt` not passed
5. Check permissions against the requested route
6. Populate `req.tenantContext` with tenant info
7. Log usage: timestamp, IP, endpoint

**Rate limiting**: Sliding window counter using in-memory Map (per-key). If count exceeds `rateLimitMax` in `rateLimitWindowS`, return 429.

### Auth Middleware

```typescript
// src/auth/api-key-middleware.ts
export function createApiKeyAuthMiddleware(prisma: PrismaClient): RequestHandler {
  // 1. Extract key from Authorization header
  // 2. Validate against DB
  // 3. Check rate limit
  // 4. Populate req.tenantContext
  // 5. If invalid → 401 with RFC 7807
  // 6. If rate limited → 429 with Retry-After header
}
```

**Route permission mapping**:

| Route Pattern | Required Permission |
|---------------|-------------------|
| `GET /payments*` | `payments:read` |
| `POST /payments` | `payments:write` |
| `POST /payments/:id/replay` | `payments:write` |
| `*/webhooks/*` | `webhooks:manage` |
| `GET /admin/fraud/*` | `fraud:read` |
| `POST/PUT/DELETE /admin/fraud/*` | `fraud:write` |
| `GET /tokens*` | `tokens:read` |
| `POST /tokens/revoke/*` | `tokens:write` |
| `GET /admin/chaos*` | `admin:chaos` |
| `POST /admin/chaos*` | `admin:chaos` |
| `GET /admin/metrics` | `admin:read` |
| `GET /admin/logs` | `admin:read` |
| `GET /admin/providers*` | `providers:read` |

### New Backend Files

| File | Purpose |
|------|---------|
| `src/auth/api-key-service.ts` | Key generation, validation, revocation, listing |
| `src/auth/api-key-middleware.ts` | Express middleware for API key auth + rate limiting |
| `src/auth/permissions.ts` | Permission definitions, route-to-permission mapping |

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api-keys` | Generate new API key (returns full key once) |
| `GET` | `/api-keys` | List keys for current tenant (shows prefix only, never hash) |
| `DELETE` | `/api-keys/:id` | Revoke a key |
| `PATCH` | `/api-keys/:id` | Update name, permissions, rate limit |

### Integration with main.ts

```typescript
// Before routes, after correlationMiddleware:
const apiKeyAuth = createApiKeyAuthMiddleware(prisma);

// Public routes that don't need auth
app.get("/health", healthHandler);

// Everything else requires auth
app.use(apiKeyAuth);
app.use(routes);          // Now tenant-scoped
app.use(adminRoutes);     // Now tenant-scoped
app.use("/graphql", graphql);
```

### Dashboard: API Keys Page

New page at `/settings/api-keys`:
- List of API keys with prefix, name, environment, permissions, status, lastUsedAt
- "Create Key" button → modal with environment selector, name, permission checkboxes
- On create → show full key in a copyable dialog with warning "This won't be shown again"
- Revoke button per key with confirmation

### Tests

| File | Scope |
|------|-------|
| `src/auth/api-key-service.test.ts` | Generate, validate, revoke, list, expiry check |
| `src/auth/api-key-middleware.test.ts` | Header extraction, hash validation, permission check, rate limiting |
| `src/auth/permissions.test.ts` | Route-to-permission mapping |

---

## 1C: Merchant Onboarding Flow

### New Prisma Models

```prisma
model User {
  id            String    @id @default(uuid())
  tenantId      String    @map("tenant_id")
  email         String    @unique
  passwordHash  String    @map("password_hash")
  name          String
  role          String    @default("owner") // owner, admin, developer, finance, support, viewer
  status        String    @default("active") // active, invited, disabled
  emailVerified Boolean   @default(false) @map("email_verified")
  lastLoginAt   DateTime? @map("last_login_at")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  @@index([tenantId])
  @@map("users")
}

model KybApplication {
  id                String    @id @default(uuid())
  tenantId          String    @map("tenant_id")
  businessName      String    @map("business_name")
  registrationNumber String?  @map("registration_number")
  taxId             String?   @map("tax_id")
  businessType      String    @map("business_type") // sole_proprietor, partnership, llc, corporation
  website           String?
  country           String
  address           String?
  phone             String?
  representativeName String?  @map("representative_name")
  representativeDob  String?  @map("representative_dob")
  status            String    @default("pending") // pending, approved, rejected, needs_info
  reviewedAt        DateTime? @map("reviewed_at")
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  @@index([tenantId])
  @@index([status])
  @@map("kyb_applications")
}
```

### Onboarding Flow

**Step 1 — Account Creation** (`POST /auth/register`):
1. Validate email, password (min 8 chars, bcrypt hash)
2. Create Tenant (status: `onboarding`, plan: `free`)
3. Create MerchantAccount (environment: `sandbox`)
4. Create User (role: `owner`, emailVerified: `false`)
5. Generate sandbox API keys: `pk_test_*` + `sk_test_*`
6. Log simulated verification email with token
7. Return: tenant, user, and API keys

**Step 2 — Business Verification** (`POST /onboarding/kyb`):
1. Accept business details (name, type, tax ID, address, etc.)
2. Create KybApplication (status: `pending`)
3. Simulate async review: `setTimeout(() => approve(), 5000)`
4. On approve: update tenant status → `active`, fire webhook `merchant.verified`
5. Return: KybApplication with status

**Step 3 — Payment Configuration** (`POST /onboarding/configure`):
1. Accept: enabled providers, routing preferences, fraud sensitivity, settlement currency
2. Create fraud rules based on sensitivity preset (low/medium/high):
   - Low: high thresholds, fewer rules enabled
   - Medium: default 5 rules (current defaults)
   - High: lower thresholds, all rules enabled, extra velocity checks
3. Update MerchantAccount with settlement currency and payout schedule
4. Return: configuration summary

**Step 4 — Go Live** (`POST /onboarding/go-live`):
1. Verify KYB is approved
2. Generate production API keys: `pk_live_*`
3. Create production MerchantAccount (environment: `production`)
4. Update tenant status → `active` if not already
5. Return: production keys + integration quickstart

### Session Management

For the dashboard (not API keys), use JWT tokens:

```typescript
// src/auth/session-service.ts
export interface SessionService {
  login(email: string, password: string): Promise<Result<{ token: string; user: UserRecord }, AuthError>>;
  verifyToken(token: string): Result<TokenPayload, AuthError>;
  refreshToken(token: string): Result<{ token: string }, AuthError>;
}
```

JWT payload: `{ userId, tenantId, role, environment, iat, exp }`. Token expires in 24h. Stored in httpOnly cookie.

### New Backend Files

| File | Purpose |
|------|---------|
| `src/auth/session-service.ts` | Login, JWT creation/verification |
| `src/auth/onboarding-service.ts` | 4-step onboarding flow logic |
| `src/auth/password.ts` | bcrypt hash/compare helpers |

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/auth/register` | Step 1: Create account |
| `POST` | `/auth/login` | Login, return JWT |
| `POST` | `/auth/verify-email/:token` | Verify email address |
| `GET` | `/auth/me` | Current user + tenant info |
| `POST` | `/onboarding/kyb` | Step 2: Submit business details |
| `GET` | `/onboarding/kyb` | Get KYB status |
| `POST` | `/onboarding/configure` | Step 3: Payment config |
| `POST` | `/onboarding/go-live` | Step 4: Activate production |

### Dashboard: Onboarding Wizard

New page at `/onboarding` with multi-step form:

- **Progress bar**: 4 steps with completed/current/upcoming indicators
- **Step 1**: Email, password, company name, country fields. Submit → auto-login
- **Step 2**: Business details form (type dropdown, tax ID, address, representative). Shows "Pending Review" spinner then "Approved" checkmark
- **Step 3**: Provider checkboxes (Stripe/Adyen/PayPal), fraud sensitivity radio (Low/Medium/High), settlement currency dropdown
- **Step 4**: Shows generated production API keys (copy button), integration code snippets, "Go to Dashboard" button

State persisted via API — user can close browser and resume from last completed step.

### Tests

| File | Scope |
|------|-------|
| `src/auth/onboarding-service.test.ts` | Full 4-step flow, validation, KYB auto-approve |
| `src/auth/session-service.test.ts` | Login, JWT verify, token expiry |
| `src/auth/password.test.ts` | Hash/compare correctness |

---

## 1D: RBAC & Team Dashboard

### Permissions Matrix

```typescript
// src/auth/permissions.ts
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner:     ["*"],  // Everything
  admin:     ["payments:*", "webhooks:*", "fraud:*", "tokens:*", "providers:*", "api-keys:*", "team:*", "admin:*"],
  developer: ["payments:*", "webhooks:*", "api-keys:read", "api-keys:create", "providers:read", "admin:read", "fraud:read"],
  finance:   ["payments:read", "tokens:read", "providers:read"],
  support:   ["payments:read", "tokens:read", "webhooks:read"],
  viewer:    ["payments:read", "providers:read", "admin:read"],
};
```

Wildcard `*` matches everything. `payments:*` matches `payments:read` and `payments:write`. Permission checking is hierarchical.

### New Prisma Models

```prisma
model TeamMember {
  id          String    @id @default(uuid())
  tenantId    String    @map("tenant_id")
  userId      String    @map("user_id")
  role        String    @default("viewer") // owner, admin, developer, finance, support, viewer
  status      String    @default("active") // active, invited, disabled
  invitedBy   String?   @map("invited_by")
  invitedAt   DateTime? @map("invited_at")
  acceptedAt  DateTime? @map("accepted_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@unique([tenantId, userId])
  @@index([tenantId])
  @@map("team_members")
}

model InviteToken {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  email     String
  role      String
  token     String   @unique
  expiresAt DateTime @map("expires_at")
  usedAt    DateTime? @map("used_at")
  createdAt DateTime @default(now()) @map("created_at")

  @@index([tenantId])
  @@index([token])
  @@map("invite_tokens")
}
```

### Invitation Flow

1. Owner/admin calls `POST /team/invite` with email + role
2. Generate cryptographically random invite token (48 bytes, base62)
3. Create InviteToken record (expires in 7 days)
4. Log simulated email with accept link: `/invite/accept?token=xxx`
5. Recipient opens link → shown a "Set Password" form
6. On submit: create User, create TeamMember, mark invite as used
7. User can now log in and see the dashboard scoped to that tenant

### New Backend Files

| File | Purpose |
|------|---------|
| `src/auth/team-service.ts` | Invite, accept, list members, change role, disable |
| `src/auth/rbac-middleware.ts` | Permission check middleware: `requirePermission("payments:write")` |
| `src/auth/roles.ts` | Role definitions, permission matrix, role hierarchy |

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/team` | List team members for current tenant |
| `POST` | `/team/invite` | Invite new member (email + role) |
| `POST` | `/team/invite/accept` | Accept invite, set password |
| `PATCH` | `/team/:memberId/role` | Change member's role |
| `PATCH` | `/team/:memberId/disable` | Disable a member |
| `DELETE` | `/team/:memberId` | Remove member (owner only) |

### Dashboard: Team Management Page

New page at `/settings/team`:
- **Member list**: Name, email, role badge, status badge, last login
- **Invite button** → modal: email input, role dropdown, "Send Invite" button
- **Per-member actions**: Change role dropdown, disable toggle, remove button
- **Pending invites section**: Email, role, sent date, "Resend" / "Revoke" buttons

### Dashboard: Login Page

New page at `/login`:
- Email + password form
- "Forgot password" link (simulated — logs reset link)
- On success → redirect to `/` (dashboard)
- JWT stored in httpOnly cookie via API response `Set-Cookie` header

### Dashboard: Permission Enforcement

Every page wraps its content in a permission check:

```typescript
// Pattern in each page
const { user } = useTenantContext();
if (!hasPermission(user.role, "payments:write")) {
  return <InsufficientPermissions />;
}
```

The API client sends the JWT cookie automatically. Backend validates permissions. Dashboard hides/disables UI elements the user's role can't use (defense in depth — backend is the real gate).

### Tests

| File | Scope |
|------|-------|
| `src/auth/team-service.test.ts` | Invite, accept, role change, disable |
| `src/auth/rbac-middleware.test.ts` | Permission checks, role hierarchy, wildcard matching |
| `src/auth/roles.test.ts` | Permission matrix correctness |

---

## Implementation Order

```
Step 1: Prisma migration (add tenantId to all 12 models + 8 new models)
Step 2: TenantContext + tenant-scoped Prisma proxy (src/tenancy/)
Step 3: Tenant/MerchantAccount CRUD (src/tenancy/tenant-service.ts)
Step 4: User model + password hashing + session service (src/auth/)
Step 5: API key generation + validation + middleware (src/auth/)
Step 6: Wire auth middleware into main.ts (before routes)
Step 7: Update all existing tests to pass with tenantId
Step 8: Onboarding service (4-step flow)
Step 9: RBAC middleware + team service
Step 10: Dashboard: login page + tenant context provider
Step 11: Dashboard: onboarding wizard
Step 12: Dashboard: API keys page + team management page
Step 13: Update all existing dashboard pages with tenant scoping
```

Steps 1-7 are the foundation — nothing else works without them. Steps 8-9 build the auth features. Steps 10-13 are dashboard work that can partially parallelize.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing 207 tests | Run tests after each step. Existing tests get a `DEFAULT_TENANT_ID` constant injected where needed. |
| Prisma migration on existing data | Assign all existing records to a "demo" tenant. Migration script sets `tenant_id = 'demo-tenant-id'` before making column NOT NULL. |
| Performance of tenant-scoped Prisma proxy | Proxy only adds a `where` clause — no additional DB round trips. Composite indexes on `(tenantId, ...)` ensure query plans stay efficient. |
| JWT secret management | Use config: `JWT_SECRET` env var with a default for dev. In production, rotate via env. |
| bcrypt performance on key validation | Cache validated key hashes in-memory (Map with 5-min TTL). bcrypt compare is ~100ms — unacceptable for every request without caching. |
| Dashboard breaking during migration | Dashboard continues working in "demo mode" (no auth) until login page is built. Auth middleware skips validation if no `Authorization` header AND `NODE_ENV === "development"`. |

## What Changes in Existing Code

### Files Modified (not new files)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add tenantId to 12 models, add 8 new models |
| `src/main.ts` | Wire auth middleware, tenant context, seed default tenant |
| `src/core/types.ts` | Add `tenantId` to PaymentState |
| `src/events/event-store.ts` | Accept tenantId in factory (or use scoped Prisma) |
| `src/events/snapshot-store.ts` | Unique constraint change |
| `src/api/routes.ts` | Extract tenantId from context in handlers |
| `src/api/admin-routes.ts` | Extract tenantId from context in all handlers |
| `src/idempotency/idempotency-middleware.ts` | Add tenantId to lookup/store |
| `src/saga/saga-recovery.ts` | Scope recovery scan to tenant |
| `src/fraud/seed-rules.ts` | Seed rules per tenant, not globally |
| `dashboard/src/lib/api.ts` | Add auth headers (JWT cookie) |
| `dashboard/src/app/layout.tsx` | Add auth context provider, conditional sidebar |

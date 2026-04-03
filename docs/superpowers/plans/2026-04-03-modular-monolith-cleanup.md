# Modular Monolith Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up the code smells identified in the discovery audit without changing the fundamental architecture. The codebase is already a well-structured modular monolith — we improve it, not replace it.

**Architecture:** Split the 2,015-line `admin-routes.ts` into domain-specific sub-routers. Extract shared utilities. Fix silent error swallows. Add production safety checks. Move DB queries from routes to services.

**Tech Stack:** TypeScript, Express, Prisma, Vitest

---

### Task 1: Extract shared route utilities

**Files:**
- Create: `src/api/route-helpers.ts`
- Modify: `src/api/routes.ts`
- Modify: `src/api/auth-routes.ts`

Extract `respondProblem()`, `respondFromError()`, and `getTenantId()` into a shared module.

### Task 2: Split admin-routes.ts into domain sub-routers

**Files:**
- Create: `src/api/admin/chaos-routes.ts`
- Create: `src/api/admin/circuit-breaker-routes.ts`
- Create: `src/api/admin/metrics-routes.ts`
- Create: `src/api/admin/provider-routes.ts`
- Create: `src/api/admin/fraud-routes.ts`
- Create: `src/api/admin/token-routes.ts`
- Create: `src/api/admin/fx-routes.ts`
- Create: `src/api/admin/ledger-routes.ts`
- Create: `src/api/admin/settlement-routes.ts`
- Create: `src/api/admin/subscription-routes.ts`
- Create: `src/api/admin/billing-routes.ts`
- Create: `src/api/admin/dispute-routes.ts`
- Create: `src/api/admin/analytics-routes.ts`
- Create: `src/api/admin/experiment-routes.ts`
- Create: `src/api/admin/checkout-routes.ts`
- Create: `src/api/admin/sandbox-routes.ts`
- Create: `src/api/admin/queue-routes.ts`
- Create: `src/api/admin/webhook-routes.ts`
- Create: `src/api/admin/misc-routes.ts` (logs, bulkheads, saga recovery, verify, decline codes, retries, 3DS, payment methods, webhook catalog)
- Modify: `src/api/admin-routes.ts` → becomes thin composer

### Task 3: Fix silent error swallows

**Files:**
- Modify: `src/api/payment-service.ts` (lines 242, 323)
- Modify: `src/api/routes.ts` (5 bare catch blocks)

### Task 4: Fix import type and add production config validation

**Files:**
- Modify: `src/api/payment-service.ts` (line 1)
- Modify: `src/core/config.ts`

### Task 5: Run tests and commit

Run full test suite, fix any issues, commit.

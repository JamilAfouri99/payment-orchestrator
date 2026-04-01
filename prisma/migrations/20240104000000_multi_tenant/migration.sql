-- ============================================================================
-- Phase 1: Multi-Tenant SaaS Transformation
-- Adds tenantId to all existing tables + creates new auth/tenant tables
-- ============================================================================

-- ─── New Tables ─────────────────────────────────────────────────────────────

CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'onboarding',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "default_currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "webhook_secret" TEXT NOT NULL,
    "trial_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

CREATE TABLE "merchant_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "status" TEXT NOT NULL DEFAULT 'active',
    "mcc" TEXT,
    "business_type" TEXT,
    "risk_tier" TEXT NOT NULL DEFAULT 'medium',
    "settlement_currency" TEXT NOT NULL DEFAULT 'USD',
    "payout_schedule" TEXT NOT NULL DEFAULT 'weekly',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "merchant_accounts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "merchant_accounts_tenant_id_idx" ON "merchant_accounts"("tenant_id");

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "status" TEXT NOT NULL DEFAULT 'active',
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "merchant_account_id" TEXT,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '["payments:read","payments:write"]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "name" TEXT NOT NULL DEFAULT '',
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "last_used_ip" TEXT,
    "rate_limit_max" INTEGER NOT NULL DEFAULT 1000,
    "rate_limit_window_s" INTEGER NOT NULL DEFAULT 60,
    "created_by" TEXT,
    "revoked_by" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys"("tenant_id");
CREATE INDEX "api_keys_key_prefix_idx" ON "api_keys"("key_prefix");
CREATE INDEX "api_keys_status_idx" ON "api_keys"("status");

CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "status" TEXT NOT NULL DEFAULT 'active',
    "invited_by" TEXT,
    "invited_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "team_members_tenant_id_user_id_key" ON "team_members"("tenant_id", "user_id");
CREATE INDEX "team_members_tenant_id_idx" ON "team_members"("tenant_id");

CREATE TABLE "invite_tokens" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invite_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invite_tokens_token_key" ON "invite_tokens"("token");
CREATE INDEX "invite_tokens_tenant_id_idx" ON "invite_tokens"("tenant_id");

CREATE TABLE "kyb_applications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "registration_number" TEXT,
    "tax_id" TEXT,
    "business_type" TEXT NOT NULL,
    "website" TEXT,
    "country" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "representative_name" TEXT,
    "representative_dob" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kyb_applications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "kyb_applications_tenant_id_idx" ON "kyb_applications"("tenant_id");
CREATE INDEX "kyb_applications_status_idx" ON "kyb_applications"("status");

-- ─── Add tenantId to existing tables ────────────────────────────────────────

-- Insert a default demo tenant for existing data
INSERT INTO "tenants" ("id", "name", "slug", "status", "plan", "webhook_secret", "updated_at")
VALUES ('00000000-0000-0000-0000-000000000001', 'Demo Tenant', 'demo', 'active', 'enterprise', 'dev-webhook-secret', CURRENT_TIMESTAMP);

-- saga_executions
ALTER TABLE "saga_executions" ADD COLUMN "tenant_id" TEXT;
UPDATE "saga_executions" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "saga_executions" ALTER COLUMN "tenant_id" SET NOT NULL;
DROP INDEX IF EXISTS "saga_executions_aggregate_id_idx";
DROP INDEX IF EXISTS "saga_executions_status_idx";
CREATE INDEX "saga_executions_tenant_id_idx" ON "saga_executions"("tenant_id");
CREATE INDEX "saga_executions_tenant_id_aggregate_id_idx" ON "saga_executions"("tenant_id", "aggregate_id");
CREATE INDEX "saga_executions_tenant_id_status_idx" ON "saga_executions"("tenant_id", "status");

-- event_store
ALTER TABLE "event_store" ADD COLUMN "tenant_id" TEXT;
UPDATE "event_store" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "event_store" ALTER COLUMN "tenant_id" SET NOT NULL;
DROP INDEX IF EXISTS "event_store_aggregate_id_version_key";
DROP INDEX IF EXISTS "event_store_aggregate_id_idx";
DROP INDEX IF EXISTS "event_store_aggregate_type_idx";
DROP INDEX IF EXISTS "event_store_event_type_idx";
CREATE UNIQUE INDEX "event_store_tenant_id_aggregate_id_version_key" ON "event_store"("tenant_id", "aggregate_id", "version");
CREATE INDEX "event_store_tenant_id_aggregate_id_idx" ON "event_store"("tenant_id", "aggregate_id");
CREATE INDEX "event_store_tenant_id_aggregate_type_idx" ON "event_store"("tenant_id", "aggregate_type");
CREATE INDEX "event_store_tenant_id_event_type_idx" ON "event_store"("tenant_id", "event_type");

-- idempotency_keys
ALTER TABLE "idempotency_keys" ADD COLUMN "tenant_id" TEXT;
UPDATE "idempotency_keys" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "idempotency_keys" ALTER COLUMN "tenant_id" SET NOT NULL;
DROP INDEX IF EXISTS "idempotency_keys_key_key";
CREATE UNIQUE INDEX "idempotency_keys_tenant_id_key_key" ON "idempotency_keys"("tenant_id", "key");

-- webhook_deliveries
ALTER TABLE "webhook_deliveries" ADD COLUMN "tenant_id" TEXT;
UPDATE "webhook_deliveries" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "webhook_deliveries" ALTER COLUMN "tenant_id" SET NOT NULL;
DROP INDEX IF EXISTS "webhook_deliveries_status_idx";
DROP INDEX IF EXISTS "webhook_deliveries_next_retry_at_idx";
CREATE INDEX "webhook_deliveries_tenant_id_status_idx" ON "webhook_deliveries"("tenant_id", "status");
CREATE INDEX "webhook_deliveries_tenant_id_next_retry_at_idx" ON "webhook_deliveries"("tenant_id", "next_retry_at");

-- webhook_registrations
ALTER TABLE "webhook_registrations" ADD COLUMN "tenant_id" TEXT;
UPDATE "webhook_registrations" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "webhook_registrations" ALTER COLUMN "tenant_id" SET NOT NULL;
CREATE INDEX "webhook_registrations_tenant_id_idx" ON "webhook_registrations"("tenant_id");

-- dead_letter_queue
ALTER TABLE "dead_letter_queue" ADD COLUMN "tenant_id" TEXT;
UPDATE "dead_letter_queue" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "dead_letter_queue" ALTER COLUMN "tenant_id" SET NOT NULL;
DROP INDEX IF EXISTS "dead_letter_queue_source_type_idx";
CREATE INDEX "dead_letter_queue_tenant_id_source_type_idx" ON "dead_letter_queue"("tenant_id", "source_type");

-- event_snapshots
ALTER TABLE "event_snapshots" ADD COLUMN "tenant_id" TEXT;
UPDATE "event_snapshots" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "event_snapshots" ALTER COLUMN "tenant_id" SET NOT NULL;
DROP INDEX IF EXISTS "event_snapshots_aggregate_id_key";
CREATE UNIQUE INDEX "event_snapshots_tenant_id_aggregate_id_key" ON "event_snapshots"("tenant_id", "aggregate_id");

-- provider_metrics
ALTER TABLE "provider_metrics" ADD COLUMN "tenant_id" TEXT;
UPDATE "provider_metrics" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "provider_metrics" ALTER COLUMN "tenant_id" SET NOT NULL;
DROP INDEX IF EXISTS "provider_metrics_provider_created_at_idx";
DROP INDEX IF EXISTS "provider_metrics_provider_outcome_idx";
CREATE INDEX "provider_metrics_tenant_id_provider_created_at_idx" ON "provider_metrics"("tenant_id", "provider", "created_at");
CREATE INDEX "provider_metrics_tenant_id_provider_outcome_idx" ON "provider_metrics"("tenant_id", "provider", "outcome");

-- payment_retries
ALTER TABLE "payment_retries" ADD COLUMN "tenant_id" TEXT;
UPDATE "payment_retries" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "payment_retries" ALTER COLUMN "tenant_id" SET NOT NULL;
DROP INDEX IF EXISTS "payment_retries_status_scheduled_at_idx";
DROP INDEX IF EXISTS "payment_retries_payment_id_idx";
CREATE INDEX "payment_retries_tenant_id_status_scheduled_at_idx" ON "payment_retries"("tenant_id", "status", "scheduled_at");
CREATE INDEX "payment_retries_tenant_id_payment_id_idx" ON "payment_retries"("tenant_id", "payment_id");

-- fraud_rules
ALTER TABLE "fraud_rules" ADD COLUMN "tenant_id" TEXT;
UPDATE "fraud_rules" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "fraud_rules" ALTER COLUMN "tenant_id" SET NOT NULL;
CREATE INDEX "fraud_rules_tenant_id_idx" ON "fraud_rules"("tenant_id");

-- fraud_evaluations
ALTER TABLE "fraud_evaluations" ADD COLUMN "tenant_id" TEXT;
UPDATE "fraud_evaluations" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "fraud_evaluations" ALTER COLUMN "tenant_id" SET NOT NULL;
DROP INDEX IF EXISTS "fraud_evaluations_payment_id_idx";
DROP INDEX IF EXISTS "fraud_evaluations_action_idx";
CREATE INDEX "fraud_evaluations_tenant_id_payment_id_idx" ON "fraud_evaluations"("tenant_id", "payment_id");
CREATE INDEX "fraud_evaluations_tenant_id_action_idx" ON "fraud_evaluations"("tenant_id", "action");

-- payment_tokens
ALTER TABLE "payment_tokens" ADD COLUMN "tenant_id" TEXT;
UPDATE "payment_tokens" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "payment_tokens" ALTER COLUMN "tenant_id" SET NOT NULL;
DROP INDEX IF EXISTS "payment_tokens_customer_id_idx";
DROP INDEX IF EXISTS "payment_tokens_status_idx";
CREATE INDEX "payment_tokens_tenant_id_customer_id_idx" ON "payment_tokens"("tenant_id", "customer_id");
CREATE INDEX "payment_tokens_tenant_id_status_idx" ON "payment_tokens"("tenant_id", "status");

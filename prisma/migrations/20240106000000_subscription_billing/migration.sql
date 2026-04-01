-- Phase 3: Subscription Billing, Invoices & Dunning

-- Plans
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "billing_interval" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "features" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "plans_tenant_id_status_idx" ON "plans"("tenant_id", "status");

-- Subscriptions
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'trialing',
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "trial_start" TIMESTAMP(3),
    "trial_end" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "payment_method_token_id" TEXT,
    "next_billing_date" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "subscriptions_tenant_id_customer_id_idx" ON "subscriptions"("tenant_id", "customer_id");
CREATE INDEX "subscriptions_tenant_id_status_idx" ON "subscriptions"("tenant_id", "status");
CREATE INDEX "subscriptions_tenant_id_next_billing_date_idx" ON "subscriptions"("tenant_id", "next_billing_date");

-- Invoices
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "line_items" JSONB NOT NULL DEFAULT '[]',
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "tax_amount" INTEGER NOT NULL DEFAULT 0,
    "tax_rate" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "due_date" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "payment_id" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "hosted_invoice_url" TEXT NOT NULL DEFAULT '',
    "pdf_url" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoices_tenant_id_subscription_id_idx" ON "invoices"("tenant_id", "subscription_id");
CREATE INDEX "invoices_tenant_id_customer_id_idx" ON "invoices"("tenant_id", "customer_id");
CREATE INDEX "invoices_tenant_id_status_idx" ON "invoices"("tenant_id", "status");
CREATE INDEX "invoices_tenant_id_next_attempt_at_idx" ON "invoices"("tenant_id", "next_attempt_at");

-- Dunning Config
CREATE TABLE "dunning_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "max_retry_attempts" INTEGER NOT NULL DEFAULT 4,
    "retry_schedule_days" JSONB NOT NULL DEFAULT '[1, 3, 5, 7]',
    "on_first_failure" TEXT NOT NULL DEFAULT 'email_customer',
    "on_each_retry" TEXT NOT NULL DEFAULT 'email_customer',
    "on_final_failure" TEXT NOT NULL DEFAULT 'cancel_subscription',
    "grace_period_days" INTEGER NOT NULL DEFAULT 7,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dunning_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dunning_configs_tenant_id_key" ON "dunning_configs"("tenant_id");

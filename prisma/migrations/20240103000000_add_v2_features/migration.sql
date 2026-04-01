-- CreateTable
CREATE TABLE "provider_metrics" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "decline_code" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_retries" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "decline_code" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "max_attempts" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_retries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "weight" INTEGER NOT NULL DEFAULT 10,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fraud_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_evaluations" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "rule_results" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "expiry_month" INTEGER NOT NULL,
    "expiry_year" INTEGER NOT NULL,
    "encrypted_pan" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_metrics_provider_created_at_idx" ON "provider_metrics"("provider", "created_at");

-- CreateIndex
CREATE INDEX "provider_metrics_provider_outcome_idx" ON "provider_metrics"("provider", "outcome");

-- CreateIndex
CREATE INDEX "payment_retries_status_scheduled_at_idx" ON "payment_retries"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "payment_retries_payment_id_idx" ON "payment_retries"("payment_id");

-- CreateIndex
CREATE INDEX "fraud_evaluations_payment_id_idx" ON "fraud_evaluations"("payment_id");

-- CreateIndex
CREATE INDEX "fraud_evaluations_action_idx" ON "fraud_evaluations"("action");

-- CreateIndex
CREATE UNIQUE INDEX "payment_tokens_token_key" ON "payment_tokens"("token");

-- CreateIndex
CREATE INDEX "payment_tokens_customer_id_idx" ON "payment_tokens"("customer_id");

-- CreateIndex
CREATE INDEX "payment_tokens_status_idx" ON "payment_tokens"("status");

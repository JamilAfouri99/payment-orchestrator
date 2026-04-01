-- 3D Secure
CREATE TABLE "three_d_secure" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '3ds2',
    "status" TEXT NOT NULL DEFAULT 'challenge_required',
    "eci" TEXT NOT NULL DEFAULT '05',
    "cavv" TEXT NOT NULL DEFAULT '',
    "ds_trans_id" TEXT NOT NULL DEFAULT '',
    "challenge_url" TEXT NOT NULL DEFAULT '',
    "liability_shift" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "three_d_secure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "three_d_secure_tenant_id_payment_id_idx" ON "three_d_secure"("tenant_id", "payment_id");

-- Payment Methods
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "card_brand" TEXT,
    "card_last4" TEXT,
    "card_exp_month" INTEGER,
    "card_exp_year" INTEGER,
    "card_funding" TEXT,
    "bank_name" TEXT,
    "bank_last4" TEXT,
    "bank_type" TEXT,
    "wallet_provider" TEXT,
    "wallet_email" TEXT,
    "bnpl_provider" TEXT,
    "bnpl_installments" INTEGER,
    "crypto_chain" TEXT,
    "crypto_currency" TEXT,
    "crypto_address" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_methods_tenant_id_customer_id_idx" ON "payment_methods"("tenant_id", "customer_id");
CREATE INDEX "payment_methods_tenant_id_type_idx" ON "payment_methods"("tenant_id", "type");

-- Checkout Sessions
CREATE TABLE "checkout_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "merchant_account_id" TEXT NOT NULL DEFAULT 'default',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "description" TEXT NOT NULL DEFAULT '',
    "line_items" JSONB NOT NULL DEFAULT '[]',
    "customer" JSONB NOT NULL DEFAULT '{}',
    "allowed_payment_methods" JSONB NOT NULL DEFAULT '["card"]',
    "success_url" TEXT NOT NULL DEFAULT '',
    "cancel_url" TEXT NOT NULL DEFAULT '',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "payment_id" TEXT,
    "payment_method_type" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "checkout_sessions_tenant_id_status_idx" ON "checkout_sessions"("tenant_id", "status");
CREATE INDEX "checkout_sessions_tenant_id_merchant_account_id_idx" ON "checkout_sessions"("tenant_id", "merchant_account_id");

-- CreateTable
CREATE TABLE "payment_metric_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "merchant_account_id" TEXT,
    "provider_id" TEXT,
    "metric_name" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "date_range_start" TIMESTAMP(3) NOT NULL,
    "date_range_end" TIMESTAMP(3) NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'csv',
    "report_data" TEXT,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_experiments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "control_provider_id" TEXT NOT NULL,
    "control_weight" INTEGER NOT NULL DEFAULT 50,
    "variants" JSONB NOT NULL DEFAULT '[]',
    "traffic_allocation" INTEGER NOT NULL DEFAULT 100,
    "target_metrics" JSONB NOT NULL DEFAULT '["authorization_rate"]',
    "minimum_sample_size" INTEGER NOT NULL DEFAULT 1000,
    "confidence_level" INTEGER NOT NULL DEFAULT 95,
    "winner_variant" TEXT,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_experiments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_metric_snapshots_tenant_id_metric_name_period_end_idx" ON "payment_metric_snapshots"("tenant_id", "metric_name", "period_end");

-- CreateIndex
CREATE INDEX "payment_metric_snapshots_tenant_id_provider_id_metric_name_idx" ON "payment_metric_snapshots"("tenant_id", "provider_id", "metric_name");

-- CreateIndex
CREATE INDEX "report_jobs_tenant_id_status_idx" ON "report_jobs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "report_jobs_tenant_id_type_idx" ON "report_jobs"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "routing_experiments_tenant_id_status_idx" ON "routing_experiments"("tenant_id", "status");

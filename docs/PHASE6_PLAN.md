# Phase 6: Analytics, Reporting & A/B Testing

## Overview

Add real-time analytics with cached metric snapshots, async report generation with CSV export, and an A/B testing framework for payment routing decisions.

## 6A: Payment Analytics Engine

### PaymentMetricSnapshot Model

```
id, tenantId, merchantAccountId (nullable), providerId (nullable),
metricName, value (float), periodStart, periodEnd, computedAt
```

Indexes: `[tenantId, metricName, periodEnd]`, `[tenantId, providerId, metricName]`

### Metrics Computed

| Metric Name | Formula | Dimensions |
|---|---|---|
| `authorization_rate` | approved / total attempts | tenant, merchant, provider |
| `capture_rate` | captured / authorized | tenant, merchant |
| `decline_rate` | declined / total | tenant, provider + by reason code |
| `avg_transaction_value` | sum(amount) / count | tenant, merchant |
| `gross_payment_volume` | sum(captured amounts) | tenant, merchant |
| `net_revenue` | GPV - refunds - fees | tenant, merchant |
| `refund_rate` | refund_count / capture_count | tenant, merchant |
| `chargeback_rate` | dispute_count / capture_count | tenant, merchant |
| `avg_latency` | avg(latencyMs) | tenant, provider |

### Time Windows

Built-in: 1h, 24h, 7d, 30d, 90d. Custom range via query params.

### AnalyticsService Interface

```typescript
interface AnalyticsService {
  computeMetrics(window: TimeWindow): Promise<Result<MetricSnapshot[], AnalyticsError>>;
  getMetrics(filters: MetricFilters): Promise<Result<MetricSnapshot[], AnalyticsError>>;
  getTimeSeries(metricName: string, from: Date, to: Date, granularity: string): Promise<Result<TimeSeriesPoint[], AnalyticsError>>;
  compareWindows(metricName: string, current: TimeWindow, previous: TimeWindow): Promise<Result<WindowComparison, AnalyticsError>>;
}
```

### Background Job

- Runs every 5 minutes (configurable via `ANALYTICS_INTERVAL_MS`)
- Computes all metrics for 1h, 24h, 7d, 30d, 90d windows
- Upserts into PaymentMetricSnapshot table
- Non-blocking — failure doesn't affect payment processing

## 6B: Reporting & Export

### ReportJob Model

```
id, tenantId, type (transaction/settlement/dispute/revenue),
status (pending/processing/completed/failed), filters (JSON),
dateRangeStart, dateRangeEnd, format (csv/json),
resultUrl (nullable), rowCount, summary (JSON),
startedAt, completedAt, error (nullable), createdAt
```

Index: `[tenantId, status]`, `[tenantId, type]`

### ReportService Interface

```typescript
interface ReportService {
  generateTransactionReport(filters: TransactionReportFilters): Promise<Result<ReportJob, ReportError>>;
  generateSettlementReport(period: DateRange): Promise<Result<ReportJob, ReportError>>;
  generateDisputeReport(dateRange: DateRange): Promise<Result<ReportJob, ReportError>>;
  generateRevenueReport(dateRange: DateRange): Promise<Result<ReportJob, ReportError>>;
  getReport(reportId: string): Promise<Result<ReportJob, ReportError>>;
  getReportData(reportId: string): Promise<Result<string, ReportError>>;
  listReports(): Promise<Result<ReportJob[], ReportError>>;
}
```

### CSV Generation

- All reports support CSV export
- Summary stats included as header rows
- Tenant-scoped queries only
- Reports stored in `report_data` column (JSON/CSV string)

## 6C: Provider A/B Testing

### RoutingExperiment Model

```
id, tenantId, name, description,
status (draft/running/paused/completed),
controlProviderId, controlWeight,
variants (JSON array: [{providerId, weight, name}]),
trafficAllocation (percentage 0-100),
targetMetrics (JSON array of metric names),
minimumSampleSize (default 1000), confidenceLevel (default 95),
startedAt, endedAt, winnerVariant (nullable), createdAt, updatedAt
```

Indexes: `[tenantId, status]`

### Experiment Variant Assignment

When routing a payment:
1. Check for active experiment matching the tenant
2. If traffic allocation dice roll succeeds → enroll payment
3. Assign to control or variant based on weights (deterministic hash on paymentId)
4. Tag payment with experimentId + variantId in event metadata
5. Route to assigned provider, bypassing normal scoring

### ExperimentService Interface

```typescript
interface ExperimentService {
  createExperiment(input: CreateExperimentInput): Promise<Result<Experiment, ExperimentError>>;
  startExperiment(id: string): Promise<Result<Experiment, ExperimentError>>;
  pauseExperiment(id: string): Promise<Result<Experiment, ExperimentError>>;
  completeExperiment(id: string): Promise<Result<Experiment, ExperimentError>>;
  getExperiment(id: string): Promise<Result<Experiment, ExperimentError>>;
  listExperiments(): Promise<Result<Experiment[], ExperimentError>>;
  assignVariant(experimentId: string, paymentId: string): Result<VariantAssignment, ExperimentError>;
  getResults(experimentId: string): Promise<Result<ExperimentResults, ExperimentError>>;
  declareWinner(experimentId: string, variantName: string): Promise<Result<Experiment, ExperimentError>>;
}
```

### Statistical Significance

- Chi-squared test for authorization rate comparison
- Compares observed vs expected frequencies per variant
- Significant at configured confidence level (default 95%, chi-squared critical value 3.841 for 1 df)
- Reports p-value equivalent and whether significance threshold is met

### ExperimentResults Shape

```typescript
interface ExperimentResults {
  experimentId: string;
  totalSamples: number;
  variants: VariantResult[];
  isSignificant: boolean;
  chiSquared: number;
  requiredSamples: number;
  winner: string | null;
}

interface VariantResult {
  name: string;
  providerId: string;
  sampleSize: number;
  authorizationRate: number;
  avgLatencyMs: number;
  costPerTransaction: number;
}
```

## New Event Types

- `ExperimentAssigned` — payment enrolled in experiment
- `ReportGenerated` — async report completed

## Prisma Models (3 new)

1. `PaymentMetricSnapshot` — cached computed metrics
2. `ReportJob` — async report tracking
3. `RoutingExperiment` — A/B test definitions

## REST Endpoints

### Analytics
- `GET /admin/analytics/metrics` — query metrics with filters
- `GET /admin/analytics/timeseries` — time series data
- `GET /admin/analytics/compare` — window comparison
- `POST /admin/analytics/compute` — trigger metric computation

### Reports
- `POST /admin/reports` — create report job
- `GET /admin/reports` — list report jobs
- `GET /admin/reports/:id` — get report status
- `GET /admin/reports/:id/download` — download report data (CSV/JSON)

### Experiments
- `POST /admin/experiments` — create experiment
- `GET /admin/experiments` — list experiments
- `GET /admin/experiments/:id` — get experiment
- `POST /admin/experiments/:id/start` — start experiment
- `POST /admin/experiments/:id/pause` — pause experiment
- `POST /admin/experiments/:id/complete` — complete experiment
- `GET /admin/experiments/:id/results` — get results with significance
- `POST /admin/experiments/:id/declare-winner` — declare winner

## Dashboard

### Experiments Page (`/experiments`)
- Active experiments with live metrics per variant
- Progress bars toward minimum sample size
- Statistical significance indicator
- "Declare Winner" button
- Completed experiments archive

### Navigation
- Add "Experiments" to shell nav items

## Implementation Order

1. Prisma models + migration
2. Event types
3. AnalyticsService + tests
4. ReportService + tests
5. ExperimentService + tests
6. Wire into payment-service.ts
7. Admin routes
8. Dashboard API + Experiments page
9. Type check + full test run

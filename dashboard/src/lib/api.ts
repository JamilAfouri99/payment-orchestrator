const BASE = "/api";

export interface PaymentFxDetails {
  originalAmount: number;
  originalCurrency: string;
  convertedAmount: number;
  convertedCurrency: string;
  rate: number;
  spreadBps: number;
}

export interface PaymentState {
  id: string;
  status: string;
  amount: number;
  currency: string;
  customerId: string;
  orderId: string;
  items: { productId: string; quantity: number; pricePerUnit: number }[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  // Extended fields from new features
  providerId?: string;
  fraudScore?: number;
  fraudAction?: string;
  tokenId?: string;
  fxRate?: PaymentFxDetails;
}

export interface DomainEvent {
  id: string;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  version: number;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface HealthStatus {
  status: string;
  timestamp: string;
}

export interface WebhookRegistration {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

export interface WebhookDeliveryRecord {
  id: string;
  registrationId: string;
  eventType: string;
  url: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface DeadLetterEntry {
  id: string;
  sourceType: string;
  sourceId: string;
  error: string;
  attempts: number;
  createdAt: string;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  correlationId?: string;
  paymentId?: string;
  [key: string]: unknown;
}

export interface CircuitBreakerInfo {
  name: string;
  state: string;
}

export interface BulkheadStats {
  name: string;
  maxConcurrent: number;
  maxQueue: number;
  activeCount: number;
  queueSize: number;
  availableSlots: number;
}

export interface ServiceChaosConfig {
  failureRate: number;
  latencyMs: number;
  enabled: boolean;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  histograms: Record<string, {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
  }>;
  collectedAt: string;
}

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch(`${BASE}/health`);
  return res.json();
}

export async function fetchPayments(
  limit: number,
  offset: number,
): Promise<{ payments: PaymentState[]; total: number }> {
  const res = await fetch(`${BASE}/payments?limit=${limit}&offset=${offset}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch payments");
  }
  return res.json();
}

export async function createPayment(
  body: {
    amount: number;
    currency: string;
    customerId: string;
    orderId: string;
    items: { productId: string; quantity: number; pricePerUnit: number }[];
  },
  idempotencyKey: string,
): Promise<PaymentState> {
  const res = await fetch(`${BASE}/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to create payment");
  }
  return res.json();
}

export async function getPayment(id: string): Promise<PaymentState> {
  const res = await fetch(`${BASE}/payments/${id}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Payment not found");
  }
  return res.json();
}

export async function getPaymentEvents(id: string): Promise<DomainEvent[]> {
  const res = await fetch(`${BASE}/payments/${id}/events`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Events not found");
  }
  return res.json();
}

export async function getPaymentStateAt(
  id: string,
  at: string,
): Promise<PaymentState> {
  const res = await fetch(`${BASE}/payments/${id}/state?at=${encodeURIComponent(at)}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch temporal state");
  }
  return res.json();
}

export async function replayPayment(id: string): Promise<PaymentState> {
  const res = await fetch(`${BASE}/payments/${id}/replay`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to replay payment");
  }
  return res.json();
}

export async function registerWebhook(
  url: string,
  events: string[],
): Promise<WebhookRegistration> {
  const res = await fetch(`${BASE}/webhooks/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, events }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to register webhook");
  }
  return res.json();
}

export async function fetchWebhookRegistrations(): Promise<WebhookRegistration[]> {
  const res = await fetch(`${BASE}/webhooks/registrations`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch registrations");
  }
  return res.json();
}

export async function fetchWebhookDeliveries(): Promise<WebhookDeliveryRecord[]> {
  const res = await fetch(`${BASE}/webhooks/deliveries`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch deliveries");
  }
  return res.json();
}

export async function fetchDeadLetterQueue(): Promise<DeadLetterEntry[]> {
  const res = await fetch(`${BASE}/webhooks/dlq`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch dead letter queue");
  }
  return res.json();
}

export async function retryDeadLetter(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/webhooks/dlq/${id}/retry`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to retry dead letter entry");
  }
  return res.json();
}

export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<{ valid: boolean; computedSignature: string; expectedSignature: string }> {
  const res = await fetch(`${BASE}/webhooks/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload, signature, secret }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Verification failed");
  }
  return res.json();
}

export async function fetchChaosConfig(): Promise<{
  services: Record<string, ServiceChaosConfig>;
}> {
  const res = await fetch(`${BASE}/admin/chaos`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch chaos config");
  }
  return res.json();
}

export async function updateChaosConfig(config: {
  service: string;
  failureRate?: number;
  latencyMs?: number;
  enabled?: boolean;
}): Promise<{ services: Record<string, ServiceChaosConfig> }> {
  const res = await fetch(`${BASE}/admin/chaos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to update chaos config");
  }
  return res.json();
}

export async function resetChaos(): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/admin/chaos/reset`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to reset chaos");
  }
  return res.json();
}

export async function fetchCircuitBreakers(): Promise<{
  breakers: CircuitBreakerInfo[];
}> {
  const res = await fetch(`${BASE}/admin/circuit-breakers`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch circuit breakers");
  }
  return res.json();
}

export async function resetCircuitBreaker(
  name: string,
): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/admin/circuit-breakers/${name}/reset`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to reset circuit breaker");
  }
  return res.json();
}

export async function fetchMetrics(): Promise<MetricsSnapshot> {
  const res = await fetch(`${BASE}/admin/metrics`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch metrics");
  }
  return res.json();
}

export async function fetchLogs(limit: number): Promise<{ logs: LogEntry[] }> {
  const res = await fetch(`${BASE}/admin/logs?limit=${limit}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch logs");
  }
  return res.json();
}

export async function runSagaRecovery(): Promise<{
  found: number;
  compensated: number;
  failed: number;
  details: unknown[];
}> {
  const res = await fetch(`${BASE}/admin/saga-recovery`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to run saga recovery");
  }
  return res.json();
}

export async function fetchBulkheads(): Promise<{ bulkheads: BulkheadStats[] }> {
  const res = await fetch(`${BASE}/admin/bulkheads`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch bulkheads");
  }
  return res.json();
}

// ─── Provider types ───────────────────────────────────────────────────────────

export interface ProviderInfo {
  name: string;
  supportedCurrencies: string[];
  supportedRegions: string[];
  costBasisPoints: number;
  settlementCurrency: string;
  circuitBreaker: string;
}

export interface ProviderStats {
  provider: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

export interface RoutingDecision {
  providerId: string;
  score: number;
  reasons: string[];
  fallbackOrder: string[];
}

export async function fetchProviders(): Promise<{ providers: ProviderInfo[] }> {
  const res = await fetch(`${BASE}/admin/providers`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch providers");
  }
  return res.json();
}

export async function fetchProviderMetrics(
  window?: string,
): Promise<{ stats: ProviderStats[] }> {
  const url = window ? `${BASE}/admin/providers/metrics?window=${window}` : `${BASE}/admin/providers/metrics`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch provider metrics");
  }
  return res.json();
}

export async function fetchProviderStats(
  name: string,
  window?: string,
): Promise<ProviderStats> {
  const url = window
    ? `${BASE}/admin/providers/${name}/metrics?window=${window}`
    : `${BASE}/admin/providers/${name}/metrics`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch provider stats");
  }
  return res.json();
}

export async function simulateRouting(
  amount: number,
  currency: string,
  region: string,
): Promise<RoutingDecision> {
  const res = await fetch(`${BASE}/admin/routing/simulate?amount=${amount}&currency=${currency}&region=${region}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to simulate routing");
  }
  return res.json();
}

// ─── Fraud types ──────────────────────────────────────────────────────────────

export interface FraudRuleRecord {
  id: string;
  name: string;
  description: string;
  ruleType: string;
  config: Record<string, unknown>;
  weight: number;
  enabled: boolean;
}

export interface FraudRuleResult {
  ruleId: string;
  ruleName: string;
  ruleType: string;
  triggered: boolean;
  score: number;
  detail: string;
}

export interface FraudResult {
  score: number;
  action: string;
  ruleResults: FraudRuleResult[];
  evaluatedAt: string;
}

export async function fetchFraudRules(): Promise<{ rules: FraudRuleRecord[] }> {
  const res = await fetch(`${BASE}/admin/fraud/rules`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch fraud rules");
  }
  return res.json();
}

export async function createFraudRule(
  rule: Omit<FraudRuleRecord, "id">,
): Promise<FraudRuleRecord> {
  const res = await fetch(`${BASE}/admin/fraud/rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to create fraud rule");
  }
  return res.json();
}

export async function updateFraudRule(
  id: string,
  rule: Partial<Omit<FraudRuleRecord, "id">>,
): Promise<FraudRuleRecord> {
  const res = await fetch(`${BASE}/fraud/rules/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to update fraud rule");
  }
  return res.json();
}

export async function deleteFraudRule(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/fraud/rules/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to delete fraud rule");
  }
  return res.json();
}

export async function fetchPaymentFraud(paymentId: string): Promise<FraudResult> {
  const res = await fetch(`${BASE}/payments/${paymentId}/fraud`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch fraud result");
  }
  return res.json();
}

export async function simulateFraud(params: {
  amount: number;
  currency: string;
  region?: string;
  customerPaymentCount?: number;
}): Promise<FraudResult> {
  const res = await fetch(`${BASE}/admin/fraud/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to simulate fraud check");
  }
  return res.json();
}

// ─── Token types ──────────────────────────────────────────────────────────────

export interface TokenRecord {
  token: string;
  last4: string;
  brand: string;
  expiryMonth: number;
  expiryYear: number;
  customerId: string;
  status: string;
  usageCount: number;
  createdAt: string;
}

export async function fetchTokens(
  customerId?: string,
): Promise<{ tokens: TokenRecord[] }> {
  const url = customerId
    ? `${BASE}/tokens?customerId=${encodeURIComponent(customerId)}`
    : `${BASE}/tokens`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch tokens");
  }
  return res.json();
}

export async function revokeToken(token: string): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/tokens/revoke/${token}`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to revoke token");
  }
  return res.json();
}

// ─── FX types ─────────────────────────────────────────────────────────────────

export interface FxRate {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  spreadBps: number;
  updatedAt: string;
}

export async function fetchFxRates(): Promise<{ rates: FxRate[] }> {
  const res = await fetch(`${BASE}/admin/fx/rates`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch FX rates");
  }
  return res.json();
}

export async function updateFxRate(
  from: string,
  to: string,
  rate: number,
  spreadBps: number,
): Promise<{ success: boolean; rates: FxRate[] }> {
  const res = await fetch(`${BASE}/admin/fx/rates`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, rate, spreadBps }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to update FX rate");
  }
  return res.json();
}

// ─── Decline codes ────────────────────────────────────────────────────────────

export interface DeclineCodeDef {
  code: string;
  category: string;
  description: string;
  retryable: boolean;
  suggestedAction: string;
  maxRetries: number;
}

export async function fetchDeclineCodes(): Promise<{ codes: DeclineCodeDef[] }> {
  const res = await fetch(`${BASE}/admin/decline-codes`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch decline codes");
  }
  return res.json();
}

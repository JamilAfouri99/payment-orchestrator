const BASE = "/api";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("auth_token");
}

export function setToken(token: string): void {
  localStorage.setItem("auth_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("auth_token");
}

async function authedFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...init, headers });
}

// ─── Auth types ───────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: string;
}

export interface AuthTenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface RegisterResponse {
  token: string;
  user: AuthUser;
  tenant: AuthTenant;
  apiKey: { prefix: string; environment: string };
}

export async function register(
  email: string,
  password: string,
  name: string,
  companyName: string,
  slug: string,
  country: string,
): Promise<RegisterResponse> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name, companyName, slug, country }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || err.message || "Registration failed");
  }
  return res.json();
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || err.message || "Invalid credentials");
  }
  return res.json();
}

export async function getMe(): Promise<{ user: AuthUser; tenant: AuthTenant }> {
  const res = await authedFetch(`${BASE}/auth/me`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || err.message || "Failed to fetch user");
  }
  return res.json();
}

// ─── Onboarding types ─────────────────────────────────────────────────────────

export interface KybApplication {
  id: string;
  status: string;
  businessName: string;
  businessType: string;
  country: string;
  createdAt: string;
}

export async function submitKyb(
  details: Record<string, unknown>,
): Promise<KybApplication> {
  const res = await authedFetch(`${BASE}/onboarding/kyb`, {
    method: "POST",
    body: JSON.stringify(details),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || err.message || "KYB submission failed");
  }
  return res.json();
}

export async function getKybStatus(): Promise<KybApplication | null> {
  const res = await authedFetch(`${BASE}/onboarding/kyb`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || err.message || "Failed to fetch KYB status");
  }
  return res.json();
}

export async function configureOnboarding(
  config: Record<string, unknown>,
): Promise<{ success: boolean }> {
  const res = await authedFetch(`${BASE}/onboarding/configure`, {
    method: "POST",
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || err.message || "Configuration failed");
  }
  return res.json();
}

export async function goLive(): Promise<{
  apiKey: { prefix: string; key: string };
  merchantAccount: { id: string; environment: string };
}> {
  const res = await authedFetch(`${BASE}/onboarding/go-live`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || err.message || "Go live failed");
  }
  return res.json();
}

// ─── API Key types ────────────────────────────────────────────────────────────

export interface ApiKeyRecord {
  id: string;
  keyPrefix: string;
  environment: string;
  permissions: string[];
  status: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export async function createApiKey(opts: {
  environment: string;
  name?: string;
  permissions?: string[];
}): Promise<{ key: string; record: ApiKeyRecord }> {
  const res = await authedFetch(`${BASE}/api-keys`, {
    method: "POST",
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || err.message || "Failed to create API key");
  }
  return res.json();
}

export async function listApiKeys(): Promise<{ keys: ApiKeyRecord[] }> {
  const res = await authedFetch(`${BASE}/api-keys`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || err.message || "Failed to list API keys");
  }
  return res.json();
}

export async function revokeApiKey(
  id: string,
): Promise<{ success: boolean }> {
  const res = await authedFetch(`${BASE}/api-keys/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || err.message || "Failed to revoke API key");
  }
  return res.json();
}

// ─── Team types ───────────────────────────────────────────────────────────────

export interface TeamMemberRecord {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
}

export async function listTeamMembers(): Promise<{
  members: TeamMemberRecord[];
}> {
  const res = await authedFetch(`${BASE}/team`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || err.message || "Failed to list team members");
  }
  return res.json();
}

export async function inviteTeamMember(
  email: string,
  role: string,
): Promise<{ inviteId: string }> {
  const res = await authedFetch(`${BASE}/team/invite`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || err.message || "Failed to send invite");
  }
  return res.json();
}

export async function acceptInvite(
  token: string,
  name: string,
  password: string,
): Promise<LoginResponse> {
  const res = await fetch(`${BASE}/team/invite/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, name, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || err.message || "Failed to accept invite");
  }
  return res.json();
}

export async function changeTeamRole(
  memberId: string,
  role: string,
): Promise<{ success: boolean }> {
  const res = await authedFetch(`${BASE}/team/${memberId}/role`, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || err.message || "Failed to change role");
  }
  return res.json();
}

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

// ─── Ledger types ────────────────────────────────────────────────────────────

export interface LedgerAccountRecord {
  id: string;
  tenantId: string;
  type: "asset" | "liability" | "revenue" | "expense";
  name: string;
  currency: string;
  isSystemAccount: boolean;
  balance: number;
  createdAt: string;
}

export interface LedgerEntryRecord {
  id: string;
  tenantId: string;
  transactionId: string;
  accountId: string;
  direction: "debit" | "credit";
  amount: number;
  currency: string;
  effectiveAt: string;
  postedAt: string;
  metadata: Record<string, unknown>;
}

export interface LedgerTransactionRecord {
  id: string;
  tenantId: string;
  type: string;
  idempotencyKey: string;
  status: string;
  description: string;
  entries: LedgerEntryRecord[];
  createdAt: string;
}

export interface AccountBalance {
  accountId: string;
  accountName: string;
  accountType: string;
  currency: string;
  balance: number;
  asOf: string;
}

export interface ReconciliationResult {
  passed: boolean;
  totalDebits: number;
  totalCredits: number;
  discrepancy: number;
  orphanedEntries: number;
  invalidTransactions: number;
  checkedAt: string;
}

export async function fetchLedgerAccounts(): Promise<{ accounts: LedgerAccountRecord[] }> {
  const res = await fetch(`${BASE}/admin/ledger/accounts`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch ledger accounts");
  }
  return res.json();
}

export async function fetchAccountBalance(
  accountId: string,
  asOf?: string,
): Promise<AccountBalance> {
  const url = asOf
    ? `${BASE}/admin/ledger/accounts/${accountId}/balance?asOf=${encodeURIComponent(asOf)}`
    : `${BASE}/admin/ledger/accounts/${accountId}/balance`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch balance");
  }
  return res.json();
}

export async function fetchAccountStatement(
  accountId: string,
  from?: string,
  to?: string,
): Promise<{ entries: LedgerEntryRecord[] }> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  const res = await fetch(`${BASE}/admin/ledger/accounts/${accountId}/statement${qs ? `?${qs}` : ""}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch statement");
  }
  return res.json();
}

export async function fetchLedgerTransactions(
  limit?: number,
  offset?: number,
): Promise<{ transactions: LedgerTransactionRecord[]; total: number }> {
  const res = await fetch(`${BASE}/admin/ledger/transactions?limit=${limit ?? 50}&offset=${offset ?? 0}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch ledger transactions");
  }
  return res.json();
}

export async function fetchLedgerTransaction(
  id: string,
): Promise<LedgerTransactionRecord> {
  const res = await fetch(`${BASE}/admin/ledger/transactions/${id}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch transaction");
  }
  return res.json();
}

export async function runReconciliation(): Promise<ReconciliationResult> {
  const res = await fetch(`${BASE}/admin/ledger/reconcile`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Reconciliation failed");
  }
  return res.json();
}

// ─── Settlement types ────────────────────────────────────────────────────────

export interface SettlementRecord {
  id: string;
  tenantId: string;
  merchantAccountId: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  grossAmount: number;
  totalFees: number;
  totalRefunds: number;
  totalChargebacks: number;
  netAmount: number;
  currency: string;
  payoutMethod: string;
  scheduledAt: string | null;
  settledAt: string | null;
  ledgerTransactionId: string | null;
  createdAt: string;
}

export interface SettlementReportData {
  settlement: SettlementRecord;
  lineItems: Array<{
    paymentId: string;
    type: string;
    amount: number;
    currency: string;
    effectiveAt: string;
  }>;
  summary: {
    captureCount: number;
    refundCount: number;
    chargebackCount: number;
    grossAmount: number;
    totalFees: number;
    totalRefunds: number;
    totalChargebacks: number;
    netAmount: number;
  };
}

export async function fetchSettlements(
  limit?: number,
  offset?: number,
): Promise<{ settlements: SettlementRecord[]; total: number }> {
  const res = await fetch(`${BASE}/admin/settlements?limit=${limit ?? 50}&offset=${offset ?? 0}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch settlements");
  }
  return res.json();
}

export async function calculateSettlement(params: {
  merchantAccountId: string;
  periodStart: string;
  periodEnd: string;
  currency?: string;
  payoutMethod?: string;
}): Promise<SettlementRecord> {
  const res = await fetch(`${BASE}/admin/settlements/calculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Settlement calculation failed");
  }
  return res.json();
}

export async function fetchSettlement(id: string): Promise<SettlementRecord> {
  const res = await fetch(`${BASE}/admin/settlements/${id}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch settlement");
  }
  return res.json();
}

export async function approveSettlement(id: string): Promise<SettlementRecord> {
  const res = await fetch(`${BASE}/admin/settlements/${id}/approve`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to approve settlement");
  }
  return res.json();
}

export async function processSettlement(id: string): Promise<SettlementRecord> {
  const res = await fetch(`${BASE}/admin/settlements/${id}/process`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to process settlement");
  }
  return res.json();
}

export async function fetchSettlementReport(id: string): Promise<SettlementReportData> {
  const res = await fetch(`${BASE}/admin/settlements/${id}/report`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Failed to fetch settlement report");
  }
  return res.json();
}

export function getSettlementExportUrl(id: string): string {
  return `${BASE}/admin/settlements/${id}/export`;
}

// ─── Subscription Billing ────────────────────────────────────────────────────

export interface PlanRecord {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  billingInterval: string;
  amount: number;
  currency: string;
  trialDays: number;
  features: string[];
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionRecord {
  id: string;
  tenantId: string;
  customerId: string;
  planId: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialStart: string | null;
  trialEnd: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  paymentMethodTokenId: string | null;
  nextBillingDate: string;
  quantity: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceRecord {
  id: string;
  tenantId: string;
  subscriptionId: string;
  customerId: string;
  status: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitAmount: number;
    amount: number;
    periodStart: string;
    periodEnd: string;
  }>;
  subtotal: number;
  taxAmount: number;
  taxRate: number;
  total: number;
  currency: string;
  dueDate: string;
  paidAt: string | null;
  paymentId: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  hostedInvoiceUrl: string;
  pdfUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface DunningConfigRecord {
  id: string;
  tenantId: string;
  maxRetryAttempts: number;
  retryScheduleDays: number[];
  onFirstFailure: string;
  onEachRetry: string;
  onFinalFailure: string;
  gracePeriodDays: number;
}

export interface DunningFlowRecord {
  invoiceId: string;
  subscriptionId: string;
  customerId: string;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  invoiceTotal: number;
  currency: string;
  startedAt: string;
  status: string;
}

export interface RetryAnalyticsRecord {
  totalAttempts: number;
  totalRecovered: number;
  recoveryRate: number;
  byHourOfDay: Array<{ hour: number; attempts: number; successes: number; rate: number }>;
  byDayOfWeek: Array<{ day: number; dayName: string; attempts: number; successes: number; rate: number }>;
}

export interface BillingCycleResultRecord {
  processed: number;
  invoicesGenerated: number;
  paymentSuccesses: number;
  paymentFailures: number;
}

export interface UpcomingInvoiceRecord {
  subscriptionId: string;
  planName: string;
  amount: number;
  currency: string;
  quantity: number;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
}

// Plans

export async function createPlan(data: {
  name: string;
  description?: string;
  billingInterval: string;
  amount: number;
  currency?: string;
  trialDays?: number;
  features?: string[];
}): Promise<PlanRecord> {
  const res = await authedFetch(`${BASE}/admin/subscriptions/plans`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to create plan");
  }
  return res.json();
}

export async function fetchPlans(): Promise<PlanRecord[]> {
  const res = await authedFetch(`${BASE}/admin/subscriptions/plans`);
  if (!res.ok) throw new Error("Failed to fetch plans");
  const data = await res.json();
  return data.plans;
}

export async function archivePlan(id: string): Promise<PlanRecord> {
  const res = await authedFetch(`${BASE}/admin/subscriptions/plans/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to archive plan");
  }
  return res.json();
}

// Subscriptions

export async function createSubscription(data: {
  customerId: string;
  planId: string;
  paymentMethodTokenId?: string;
  quantity?: number;
}): Promise<SubscriptionRecord> {
  const res = await authedFetch(`${BASE}/admin/subscriptions`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to create subscription");
  }
  return res.json();
}

export async function fetchSubscriptions(status?: string): Promise<SubscriptionRecord[]> {
  const url = status
    ? `${BASE}/admin/subscriptions?status=${status}`
    : `${BASE}/admin/subscriptions`;
  const res = await authedFetch(url);
  if (!res.ok) throw new Error("Failed to fetch subscriptions");
  const data = await res.json();
  return data.subscriptions;
}

export async function fetchSubscription(id: string): Promise<SubscriptionRecord> {
  const res = await authedFetch(`${BASE}/admin/subscriptions/${id}`);
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to fetch subscription");
  }
  return res.json();
}

export async function cancelSubscription(id: string, reason: string, immediate?: boolean): Promise<SubscriptionRecord> {
  const res = await authedFetch(`${BASE}/admin/subscriptions/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason, immediate }),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to cancel subscription");
  }
  return res.json();
}

export async function upgradeSubscription(id: string, newPlanId: string): Promise<SubscriptionRecord> {
  const res = await authedFetch(`${BASE}/admin/subscriptions/${id}/upgrade`, {
    method: "POST",
    body: JSON.stringify({ newPlanId }),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to upgrade subscription");
  }
  return res.json();
}

export async function downgradeSubscription(id: string, newPlanId: string): Promise<SubscriptionRecord> {
  const res = await authedFetch(`${BASE}/admin/subscriptions/${id}/downgrade`, {
    method: "POST",
    body: JSON.stringify({ newPlanId }),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to downgrade subscription");
  }
  return res.json();
}

export async function pauseSubscription(id: string): Promise<SubscriptionRecord> {
  const res = await authedFetch(`${BASE}/admin/subscriptions/${id}/pause`, { method: "POST" });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to pause subscription");
  }
  return res.json();
}

export async function resumeSubscription(id: string): Promise<SubscriptionRecord> {
  const res = await authedFetch(`${BASE}/admin/subscriptions/${id}/resume`, { method: "POST" });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to resume subscription");
  }
  return res.json();
}

export async function fetchUpcomingInvoice(id: string): Promise<UpcomingInvoiceRecord> {
  const res = await authedFetch(`${BASE}/admin/subscriptions/${id}/upcoming-invoice`);
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to fetch upcoming invoice");
  }
  return res.json();
}

export async function fetchSubscriptionEvents(id: string): Promise<Array<Record<string, unknown>>> {
  const res = await authedFetch(`${BASE}/admin/subscriptions/${id}/events`);
  if (!res.ok) throw new Error("Failed to fetch events");
  const data = await res.json();
  return data.events;
}

// Invoices

export async function fetchInvoices(filters?: { status?: string; subscriptionId?: string }): Promise<InvoiceRecord[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.subscriptionId) params.set("subscriptionId", filters.subscriptionId);
  const qs = params.toString();
  const res = await authedFetch(`${BASE}/admin/invoices${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch invoices");
  const data = await res.json();
  return data.invoices;
}

export async function fetchInvoice(id: string): Promise<InvoiceRecord> {
  const res = await authedFetch(`${BASE}/admin/invoices/${id}`);
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to fetch invoice");
  }
  return res.json();
}

export async function payInvoice(id: string): Promise<InvoiceRecord> {
  const res = await authedFetch(`${BASE}/admin/invoices/${id}/pay`, { method: "POST" });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to pay invoice");
  }
  return res.json();
}

export async function voidInvoice(id: string): Promise<InvoiceRecord> {
  const res = await authedFetch(`${BASE}/admin/invoices/${id}/void`, { method: "POST" });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to void invoice");
  }
  return res.json();
}

export async function processBillingCycle(): Promise<BillingCycleResultRecord> {
  const res = await authedFetch(`${BASE}/admin/billing/process`, { method: "POST" });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to process billing");
  }
  return res.json();
}

// Dunning

export async function fetchDunningConfig(): Promise<DunningConfigRecord> {
  const res = await authedFetch(`${BASE}/admin/dunning/config`);
  if (!res.ok) throw new Error("Failed to fetch dunning config");
  return res.json();
}

export async function updateDunningConfig(config: Partial<DunningConfigRecord>): Promise<DunningConfigRecord> {
  const res = await authedFetch(`${BASE}/admin/dunning/config`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to update dunning config");
  }
  return res.json();
}

export async function fetchActiveDunningFlows(): Promise<DunningFlowRecord[]> {
  const res = await authedFetch(`${BASE}/admin/dunning/active`);
  if (!res.ok) throw new Error("Failed to fetch dunning flows");
  const data = await res.json();
  return data.flows;
}

export async function processDunningRetries(): Promise<{ processed: number; recovered: number; failed: number }> {
  const res = await authedFetch(`${BASE}/admin/dunning/process`, { method: "POST" });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to process dunning retries");
  }
  return res.json();
}

export async function fetchRetryAnalytics(): Promise<RetryAnalyticsRecord> {
  const res = await authedFetch(`${BASE}/admin/dunning/analytics`);
  if (!res.ok) throw new Error("Failed to fetch retry analytics");
  return res.json();
}

// ── Disputes ──────────────────────────────────────────────────────────────────

export interface DisputeEvidenceRecord {
  id: string;
  disputeId: string;
  type: string;
  description: string;
  content: string;
  submittedAt: string;
}

export interface DisputeRecord {
  id: string;
  tenantId: string;
  paymentId: string;
  merchantAccountId: string;
  externalDisputeId: string;
  type: string;
  reason: string;
  status: string;
  amount: number;
  currency: string;
  evidenceDueBy: string;
  filedAt: string;
  respondedAt: string | null;
  resolvedAt: string | null;
  outcome: string | null;
  networkReasonCode: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  evidence: DisputeEvidenceRecord[];
}

export interface ChargebackRateRecord {
  merchantAccountId: string;
  windowDays: number;
  disputeCount: number;
  transactionCount: number;
  rate: number;
  ratePercent: string;
  threshold: "normal" | "warning" | "excessive" | "critical";
  blocked: boolean;
}

export interface EvidenceInput {
  type: string;
  description: string;
  content: string;
}

export async function createDispute(data: {
  paymentId: string;
  reason: string;
  amount: number;
  type?: string;
  merchantAccountId?: string;
}): Promise<DisputeRecord> {
  const res = await authedFetch(`${BASE}/admin/disputes`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to create dispute");
  }
  return res.json();
}

export async function fetchDisputes(filters?: {
  status?: string;
  paymentId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ disputes: DisputeRecord[]; total: number }> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.paymentId) params.set("paymentId", filters.paymentId);
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.offset) params.set("offset", String(filters.offset));
  const qs = params.toString();
  const res = await authedFetch(`${BASE}/admin/disputes${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch disputes");
  return res.json();
}

export async function fetchDispute(id: string): Promise<DisputeRecord> {
  const res = await authedFetch(`${BASE}/admin/disputes/${id}`);
  if (!res.ok) throw new Error("Failed to fetch dispute");
  return res.json();
}

export async function submitDisputeEvidence(
  disputeId: string,
  evidence: EvidenceInput[],
): Promise<DisputeRecord> {
  const res = await authedFetch(`${BASE}/admin/disputes/${disputeId}/evidence`, {
    method: "POST",
    body: JSON.stringify({ evidence }),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to submit evidence");
  }
  return res.json();
}

export async function resolveDispute(
  disputeId: string,
  outcome: "won" | "lost",
): Promise<DisputeRecord> {
  const res = await authedFetch(`${BASE}/admin/disputes/${disputeId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ outcome }),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to resolve dispute");
  }
  return res.json();
}

export async function acceptDispute(disputeId: string): Promise<DisputeRecord> {
  const res = await authedFetch(`${BASE}/admin/disputes/${disputeId}/accept`, {
    method: "POST",
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to accept dispute");
  }
  return res.json();
}

export async function fetchChargebackRate(
  merchantAccountId?: string,
): Promise<ChargebackRateRecord> {
  const params = merchantAccountId ? `?merchantAccountId=${merchantAccountId}` : "";
  const res = await authedFetch(`${BASE}/admin/disputes/chargeback-rate${params}`);
  if (!res.ok) throw new Error("Failed to fetch chargeback rate");
  return res.json();
}

// ── Split Payments ──────────────────────────────────────────────────────────

export interface PaymentSplitRecord {
  id: string;
  tenantId: string;
  paymentId: string;
  recipientType: "merchant" | "platform" | "third_party";
  recipientId: string;
  amount: number;
  currency: string;
  splitType: "fixed" | "percentage";
  description: string;
  status: "pending" | "executed" | "failed";
  ledgerTxId: string | null;
  createdAt: string;
}

export async function configureSplits(
  paymentId: string,
  paymentAmount: number,
  splits: Array<{
    recipientType: string;
    recipientId: string;
    amount: number;
    currency?: string;
    splitType?: string;
    description?: string;
  }>,
): Promise<PaymentSplitRecord[]> {
  const res = await authedFetch(`${BASE}/admin/splits`, {
    method: "POST",
    body: JSON.stringify({ paymentId, paymentAmount, splits }),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to configure splits");
  }
  return res.json();
}

export async function executeSplits(paymentId: string): Promise<PaymentSplitRecord[]> {
  const res = await authedFetch(`${BASE}/admin/splits/${paymentId}/execute`, {
    method: "POST",
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to execute splits");
  }
  return res.json();
}

export async function fetchSplits(paymentId: string): Promise<PaymentSplitRecord[]> {
  const res = await authedFetch(`${BASE}/admin/splits/${paymentId}`);
  if (!res.ok) throw new Error("Failed to fetch splits");
  return res.json();
}

// ── Payout Accounts ─────────────────────────────────────────────────────────

export interface PayoutAccountRecord {
  id: string;
  tenantId: string;
  merchantAccountId: string;
  type: "bank_account" | "wallet";
  bankName: string;
  accountNumberMasked: string;
  routingNumber: string;
  currency: string;
  country: string;
  status: "pending_verification" | "verified" | "disabled";
  isDefault: boolean;
  createdAt: string;
}

export async function createPayoutAccount(input: {
  merchantAccountId: string;
  type?: string;
  bankName: string;
  accountNumberLast4: string;
  routingNumber: string;
  currency?: string;
  country?: string;
}): Promise<PayoutAccountRecord> {
  const res = await authedFetch(`${BASE}/admin/payout-accounts`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to create payout account");
  }
  return res.json();
}

export async function fetchPayoutAccounts(
  merchantAccountId?: string,
): Promise<PayoutAccountRecord[]> {
  const params = merchantAccountId ? `?merchantAccountId=${merchantAccountId}` : "";
  const res = await authedFetch(`${BASE}/admin/payout-accounts${params}`);
  if (!res.ok) throw new Error("Failed to fetch payout accounts");
  return res.json();
}

export async function fetchPayoutAccount(id: string): Promise<PayoutAccountRecord> {
  const res = await authedFetch(`${BASE}/admin/payout-accounts/${id}`);
  if (!res.ok) throw new Error("Failed to fetch payout account");
  return res.json();
}

export async function verifyPayoutAccount(id: string): Promise<PayoutAccountRecord> {
  const res = await authedFetch(`${BASE}/admin/payout-accounts/${id}/verify`, { method: "POST" });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to verify payout account");
  }
  return res.json();
}

export async function disablePayoutAccount(id: string): Promise<PayoutAccountRecord> {
  const res = await authedFetch(`${BASE}/admin/payout-accounts/${id}/disable`, { method: "POST" });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to disable payout account");
  }
  return res.json();
}

export async function setDefaultPayoutAccount(id: string): Promise<PayoutAccountRecord> {
  const res = await authedFetch(`${BASE}/admin/payout-accounts/${id}/default`, { method: "POST" });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to set default payout account");
  }
  return res.json();
}

// ── Payouts ─────────────────────────────────────────────────────────────────

export interface PayoutRecord {
  id: string;
  tenantId: string;
  merchantAccountId: string;
  payoutAccountId: string;
  amount: number;
  currency: string;
  fees: number;
  status: "pending" | "processing" | "in_transit" | "paid" | "failed" | "canceled";
  scheduledAt: string | null;
  initiatedAt: string | null;
  arrivedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  retryCount: number;
  settlementIds: string[];
  ledgerTransactionId: string | null;
  createdAt: string;
}

export async function schedulePayout(input: {
  merchantAccountId: string;
  payoutAccountId?: string;
  amount: number;
  currency?: string;
  settlementIds?: string[];
}): Promise<PayoutRecord> {
  const res = await authedFetch(`${BASE}/admin/payouts`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to schedule payout");
  }
  return res.json();
}

export async function fetchPayouts(filters?: {
  status?: string;
  merchantAccountId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ payouts: PayoutRecord[]; total: number }> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.merchantAccountId) params.set("merchantAccountId", filters.merchantAccountId);
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.offset) params.set("offset", String(filters.offset));
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await authedFetch(`${BASE}/admin/payouts${qs}`);
  if (!res.ok) throw new Error("Failed to fetch payouts");
  return res.json();
}

export async function fetchPayout(id: string): Promise<PayoutRecord> {
  const res = await authedFetch(`${BASE}/admin/payouts/${id}`);
  if (!res.ok) throw new Error("Failed to fetch payout");
  return res.json();
}

export async function processPayout(id: string): Promise<PayoutRecord> {
  const res = await authedFetch(`${BASE}/admin/payouts/${id}/process`, { method: "POST" });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to process payout");
  }
  return res.json();
}

export async function cancelPayout(id: string): Promise<PayoutRecord> {
  const res = await authedFetch(`${BASE}/admin/payouts/${id}/cancel`, { method: "POST" });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.detail || "Failed to cancel payout");
  }
  return res.json();
}

// ─── Analytics ─────────────────────────────────────────────────────────────

export interface MetricSnapshotRecord {
  id: string;
  tenantId: string;
  merchantAccountId: string | null;
  providerId: string | null;
  metricName: string;
  value: number;
  periodStart: string;
  periodEnd: string;
  computedAt: string;
}

export interface WindowComparisonRecord {
  metricName: string;
  current: { value: number; periodStart: string; periodEnd: string };
  previous: { value: number; periodStart: string; periodEnd: string };
  changePercent: number;
  improved: boolean;
}

export async function fetchAnalyticsMetrics(params?: {
  metricName?: string;
  providerId?: string;
  window?: string;
}): Promise<{ metrics: MetricSnapshotRecord[] }> {
  const query = new URLSearchParams();
  if (params?.metricName) query.set("metricName", params.metricName);
  if (params?.providerId) query.set("providerId", params.providerId);
  if (params?.window) query.set("window", params.window);
  const res = await authedFetch(`${BASE}/admin/analytics/metrics?${query}`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch analytics"); }
  return res.json();
}

export async function computeAnalytics(window?: string): Promise<{ metrics: MetricSnapshotRecord[]; count: number }> {
  const res = await authedFetch(`${BASE}/admin/analytics/compute`, {
    method: "POST",
    body: JSON.stringify({ window: window ?? "24h" }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to compute analytics"); }
  return res.json();
}

export async function fetchAnalyticsComparison(metricName: string, window: string): Promise<WindowComparisonRecord> {
  const res = await authedFetch(`${BASE}/admin/analytics/compare?metricName=${metricName}&window=${window}`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to compare windows"); }
  return res.json();
}

// ─── Reports ───────────────────────────────────────────────────────────────

export interface ReportJobRecord {
  id: string;
  tenantId: string;
  type: string;
  status: string;
  filters: Record<string, unknown>;
  dateRangeStart: string;
  dateRangeEnd: string;
  format: string;
  rowCount: number;
  summary: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
}

export async function createReport(params: {
  type: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  status?: string;
  customerId?: string;
}): Promise<ReportJobRecord> {
  const res = await authedFetch(`${BASE}/admin/reports`, {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to create report"); }
  return res.json();
}

export async function fetchReports(): Promise<{ reports: ReportJobRecord[] }> {
  const res = await authedFetch(`${BASE}/admin/reports`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch reports"); }
  return res.json();
}

export async function fetchReport(id: string): Promise<ReportJobRecord> {
  const res = await authedFetch(`${BASE}/admin/reports/${id}`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch report"); }
  return res.json();
}

export async function downloadReport(id: string): Promise<string> {
  const res = await authedFetch(`${BASE}/admin/reports/${id}/download`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Report not ready"); }
  return res.text();
}

// ─── Experiments ───────────────────────────────────────────────────────────

export interface ExperimentVariantRecord {
  name: string;
  providerId: string;
  weight: number;
}

export interface ExperimentRecord {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  status: string;
  controlProviderId: string;
  controlWeight: number;
  variants: ExperimentVariantRecord[];
  trafficAllocation: number;
  targetMetrics: string[];
  minimumSampleSize: number;
  confidenceLevel: number;
  winnerVariant: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface VariantResultRecord {
  name: string;
  providerId: string;
  sampleSize: number;
  authorizationRate: number;
  avgLatencyMs: number;
  costPerTransaction: number;
}

export interface ExperimentResultsRecord {
  experimentId: string;
  totalSamples: number;
  variants: VariantResultRecord[];
  isSignificant: boolean;
  chiSquared: number;
  requiredSamples: number;
  winner: string | null;
}

export async function createExperiment(params: {
  name: string;
  description?: string;
  controlProviderId: string;
  controlWeight?: number;
  variants: ExperimentVariantRecord[];
  trafficAllocation?: number;
  minimumSampleSize?: number;
  confidenceLevel?: number;
}): Promise<ExperimentRecord> {
  const res = await authedFetch(`${BASE}/admin/experiments`, {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to create experiment"); }
  return res.json();
}

export async function fetchExperiments(): Promise<{ experiments: ExperimentRecord[] }> {
  const res = await authedFetch(`${BASE}/admin/experiments`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch experiments"); }
  return res.json();
}

export async function fetchExperiment(id: string): Promise<ExperimentRecord> {
  const res = await authedFetch(`${BASE}/admin/experiments/${id}`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch experiment"); }
  return res.json();
}

export async function startExperiment(id: string): Promise<ExperimentRecord> {
  const res = await authedFetch(`${BASE}/admin/experiments/${id}/start`, { method: "POST" });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to start experiment"); }
  return res.json();
}

export async function pauseExperiment(id: string): Promise<ExperimentRecord> {
  const res = await authedFetch(`${BASE}/admin/experiments/${id}/pause`, { method: "POST" });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to pause experiment"); }
  return res.json();
}

export async function completeExperiment(id: string): Promise<ExperimentRecord> {
  const res = await authedFetch(`${BASE}/admin/experiments/${id}/complete`, { method: "POST" });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to complete experiment"); }
  return res.json();
}

export async function fetchExperimentResults(id: string): Promise<ExperimentResultsRecord> {
  const res = await authedFetch(`${BASE}/admin/experiments/${id}/results`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch results"); }
  return res.json();
}

export async function declareExperimentWinner(id: string, variantName: string): Promise<ExperimentRecord> {
  const res = await authedFetch(`${BASE}/admin/experiments/${id}/declare-winner`, {
    method: "POST",
    body: JSON.stringify({ variantName }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to declare winner"); }
  return res.json();
}

// ─── 3D Secure ────────────────────────────────────────────────────────────

export interface ThreeDSecureRecord {
  id: string;
  tenantId: string;
  paymentId: string;
  version: string;
  status: string;
  eci: string;
  cavv: string;
  dsTransId: string;
  challengeUrl: string;
  liabilityShift: boolean;
  completedAt: string | null;
  createdAt: string;
}

export async function initiate3ds(params: {
  paymentId: string;
  amount: number;
  currency?: string;
  region?: string;
  fraudScore?: number;
  isTrustedBeneficiary?: boolean;
  version?: string;
}): Promise<ThreeDSecureRecord> {
  const res = await authedFetch(`${BASE}/admin/3ds/initiate`, {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to initiate 3DS"); }
  return res.json();
}

export async function complete3ds(id: string, outcome: string): Promise<ThreeDSecureRecord> {
  const res = await authedFetch(`${BASE}/admin/3ds/${id}/complete`, {
    method: "POST",
    body: JSON.stringify({ outcome }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to complete 3DS"); }
  return res.json();
}

export async function get3dsForPayment(paymentId: string): Promise<ThreeDSecureRecord | null> {
  const res = await authedFetch(`${BASE}/admin/3ds/payment/${paymentId}`);
  if (res.status === 404) return null;
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to get 3DS"); }
  return res.json();
}

export async function check3dsRequired(params: {
  amount: number;
  currency?: string;
  region?: string;
  fraudScore?: number;
  isTrustedBeneficiary?: boolean;
}): Promise<{ required: boolean }> {
  const res = await authedFetch(`${BASE}/admin/3ds/check`, {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to check 3DS"); }
  return res.json();
}

// ─── Payment Methods ──────────────────────────────────────────────────────

export interface PaymentMethodRecord {
  id: string;
  tenantId: string;
  customerId: string;
  type: string;
  status: string;
  cardBrand: string | null;
  cardLast4: string | null;
  cardExpMonth: number | null;
  cardExpYear: number | null;
  cardFunding: string | null;
  bankName: string | null;
  bankLast4: string | null;
  bankType: string | null;
  walletProvider: string | null;
  walletEmail: string | null;
  bnplProvider: string | null;
  bnplInstallments: number | null;
  cryptoChain: string | null;
  cryptoCurrency: string | null;
  cryptoAddress: string | null;
  label: string;
  isDefault: boolean;
  createdAt: string;
}

export interface PaymentMethodCapabilityRecord {
  type: string;
  subtype: string;
  currencies: string[];
  minAmount: number;
  maxAmount: number;
  countries: string[];
}

export async function createPaymentMethod(params: Record<string, unknown>): Promise<PaymentMethodRecord> {
  const res = await authedFetch(`${BASE}/admin/payment-methods`, {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to create payment method"); }
  return res.json();
}

export async function fetchPaymentMethods(customerId: string): Promise<{ methods: PaymentMethodRecord[] }> {
  const res = await authedFetch(`${BASE}/admin/payment-methods?customerId=${customerId}`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch payment methods"); }
  return res.json();
}

export async function fetchPaymentMethod(id: string): Promise<PaymentMethodRecord> {
  const res = await authedFetch(`${BASE}/admin/payment-methods/${id}`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch payment method"); }
  return res.json();
}

export async function setDefaultPaymentMethod(id: string, customerId: string): Promise<PaymentMethodRecord> {
  const res = await authedFetch(`${BASE}/admin/payment-methods/${id}/default`, {
    method: "POST",
    body: JSON.stringify({ customerId }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to set default"); }
  return res.json();
}

export async function revokePaymentMethod(id: string): Promise<{ success: boolean }> {
  const res = await authedFetch(`${BASE}/admin/payment-methods/${id}/revoke`, { method: "POST" });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to revoke"); }
  return res.json();
}

export async function fetchSupportedPaymentMethods(currency: string, country?: string): Promise<{ methods: PaymentMethodCapabilityRecord[] }> {
  const query = new URLSearchParams({ currency });
  if (country) query.set("country", country);
  const res = await authedFetch(`${BASE}/admin/payment-methods/supported?${query}`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch supported methods"); }
  return res.json();
}

// ─── Checkout Sessions ────────────────────────────────────────────────────

export interface CheckoutSessionRecord {
  id: string;
  tenantId: string;
  merchantAccountId: string;
  amount: number;
  currency: string;
  description: string;
  lineItems: { name: string; quantity: number; unitPrice: number }[];
  customer: { email?: string; name?: string; billingAddress?: string };
  allowedPaymentMethods: string[];
  successUrl: string;
  cancelUrl: string;
  expiresAt: string;
  status: string;
  paymentId: string | null;
  paymentMethodType: string | null;
  metadata: Record<string, unknown>;
  checkoutUrl?: string;
  createdAt: string;
}

export interface ConversionStatsRecord {
  totalSessions: number;
  completedSessions: number;
  expiredSessions: number;
  openSessions: number;
  conversionRate: number;
  avgCompletionTimeMs: number;
  byPaymentMethod: Record<string, { count: number; percentage: number }>;
}

export async function createCheckoutSession(params: {
  amount: number;
  currency?: string;
  description?: string;
  lineItems?: { name: string; quantity: number; unitPrice: number }[];
  customer?: { email?: string; name?: string; billingAddress?: string };
  allowedPaymentMethods?: string[];
  successUrl?: string;
  cancelUrl?: string;
  expiresInMinutes?: number;
  metadata?: Record<string, unknown>;
}): Promise<CheckoutSessionRecord> {
  const res = await authedFetch(`${BASE}/checkout/sessions`, {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to create session"); }
  return res.json();
}

export async function fetchCheckoutSessions(params?: { status?: string; limit?: number }): Promise<{ sessions: CheckoutSessionRecord[] }> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.limit) query.set("limit", String(params.limit));
  const res = await authedFetch(`${BASE}/checkout/sessions?${query}`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch sessions"); }
  return res.json();
}

export async function fetchCheckoutSession(id: string): Promise<CheckoutSessionRecord> {
  const res = await authedFetch(`${BASE}/checkout/sessions/${id}`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch session"); }
  return res.json();
}

export async function completeCheckoutSession(id: string, paymentId: string, paymentMethodType: string): Promise<CheckoutSessionRecord> {
  const res = await authedFetch(`${BASE}/checkout/sessions/${id}/complete`, {
    method: "POST",
    body: JSON.stringify({ paymentId, paymentMethodType }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to complete session"); }
  return res.json();
}

export async function expireCheckoutSession(id: string): Promise<{ success: boolean }> {
  const res = await authedFetch(`${BASE}/checkout/sessions/${id}/expire`, { method: "POST" });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to expire session"); }
  return res.json();
}

export async function fetchCheckoutAnalytics(): Promise<ConversionStatsRecord> {
  const res = await authedFetch(`${BASE}/checkout/analytics`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch analytics"); }
  return res.json();
}

// ─── Sandbox ─────────────────────────────────────────────────────────────────

export interface TestCardRecord {
  number: string;
  behavior: string;
  description: string;
  declineCode?: string;
}

export async function fetchTestCards(): Promise<{ cards: TestCardRecord[] }> {
  const res = await authedFetch(`${BASE}/admin/sandbox/test-cards`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch test cards"); }
  return res.json();
}

export async function triggerSandboxDispute(paymentId: string): Promise<{ disputeId: string; paymentId: string }> {
  const res = await authedFetch(`${BASE}/admin/sandbox/trigger-dispute`, {
    method: "POST",
    body: JSON.stringify({ paymentId }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to trigger dispute"); }
  return res.json();
}

export async function resetSandbox(): Promise<{ deleted: number }> {
  const res = await authedFetch(`${BASE}/admin/sandbox/reset`, { method: "POST" });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to reset sandbox"); }
  return res.json();
}

// ─── Webhook Catalog ─────────────────────────────────────────────────────────

export interface WebhookEventDef {
  type: string;
  category: string;
  description: string;
  payloadFields: { name: string; type: string; description: string; required: boolean }[];
  example: Record<string, unknown>;
}

export async function fetchWebhookCatalog(category?: string): Promise<{ events: WebhookEventDef[]; categories: string[] }> {
  const params = category ? `?category=${category}` : "";
  const res = await authedFetch(`${BASE}/admin/webhook-catalog${params}`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch webhook catalog"); }
  return res.json();
}

export async function fetchWebhookEventDef(type: string): Promise<WebhookEventDef> {
  const res = await authedFetch(`${BASE}/admin/webhook-catalog/${type}`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch event definition"); }
  return res.json();
}

// ─── Queues ─────────────────────────────────────────────────────────────────

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

export interface FailedJob {
  id: string;
  name: string;
  data: unknown;
  failedReason: string;
  attemptsMade: number;
  timestamp: number;
}

export async function fetchQueueStats(): Promise<{ queues: QueueStats[] }> {
  const res = await authedFetch(`${BASE}/admin/queues`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch queue stats"); }
  return res.json();
}

export async function fetchQueueDetail(name: string): Promise<QueueStats & { name: string }> {
  const res = await authedFetch(`${BASE}/admin/queues/${name}`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch queue detail"); }
  return res.json();
}

export async function fetchFailedJobs(queue: string, limit: number = 20): Promise<{ jobs: FailedJob[] }> {
  const res = await authedFetch(`${BASE}/admin/queues/${queue}/failed?limit=${limit}`);
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to fetch failed jobs"); }
  return res.json();
}

export async function retryQueueJob(queue: string, jobId: string): Promise<{ success: boolean }> {
  const res = await authedFetch(`${BASE}/admin/queues/${queue}/retry/${jobId}`, { method: "POST" });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to retry job"); }
  return res.json();
}

export async function drainQueue(queue: string): Promise<{ success: boolean }> {
  const res = await authedFetch(`${BASE}/admin/queues/${queue}/drain`, { method: "POST" });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to drain queue"); }
  return res.json();
}

export async function pauseQueue(queue: string): Promise<{ success: boolean }> {
  const res = await authedFetch(`${BASE}/admin/queues/${queue}/pause`, { method: "POST" });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to pause queue"); }
  return res.json();
}

export async function resumeQueue(queue: string): Promise<{ success: boolean }> {
  const res = await authedFetch(`${BASE}/admin/queues/${queue}/resume`, { method: "POST" });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed to resume queue"); }
  return res.json();
}

// ─── Health ─────────────────────────────────────────────────────────────────

export interface ReadinessResult {
  status: "healthy" | "degraded" | "unhealthy";
  checks: {
    database: { status: string; latencyMs: number; error?: string };
    redis: { status: string; latencyMs: number; error?: string };
    providers: Record<string, { status: string; circuitBreaker: string }>;
    queues: Record<string, { depth: number; processing: number }>;
  };
  version: string;
  uptime: string;
}

export async function fetchReadiness(): Promise<ReadinessResult> {
  const res = await authedFetch(`${BASE}/health/ready`);
  return res.json();
}

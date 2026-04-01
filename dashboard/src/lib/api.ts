const BASE = "/api";

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
}

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch(`${BASE}/health`);
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

"use client";

import type { DomainEvent } from "@/lib/api";

const eventColors: Record<string, string> = {
  PaymentInitiated: "bg-accent",
  PaymentValidated: "bg-blue-400",
  InventoryReserved: "bg-purple-400",
  PaymentCharged: "bg-emerald-400",
  NotificationSent: "bg-teal-400",
  PaymentCompleted: "bg-success",
  PaymentFailed: "bg-danger",
  PaymentValidationFailed: "bg-danger",
  InventoryReservationFailed: "bg-danger",
  PaymentChargeFailed: "bg-danger",
  NotificationFailed: "bg-warning",
  CompensationStarted: "bg-warning",
  CompensationCompleted: "bg-warning",
  InventoryReleased: "bg-orange-400",
  PaymentRefunded: "bg-red-400",
  // Provider routing
  ProviderSelected: "bg-blue-500",
  ProviderFallback: "bg-orange-400",
  PaymentDeclined: "bg-red-500",
  // Fraud
  FraudCleared: "bg-green-400",
  FraudReview: "bg-yellow-400",
  FraudBlocked: "bg-red-600",
  // Tokenization
  CardTokenized: "bg-purple-400",
  TokenUsed: "bg-purple-300",
  // FX
  CurrencyConverted: "bg-cyan-400",
  // Retry
  RetryScheduled: "bg-yellow-500",
  RetryAttempted: "bg-orange-500",
  RetryExhausted: "bg-red-500",
};

const eventDescriptions: Record<string, string> = {
  PaymentInitiated: "Payment saga started",
  PaymentValidated: "Request validated, items verified",
  InventoryReserved: "Inventory reserved for order",
  PaymentCharged: "Payment charged successfully",
  NotificationSent: "Customer notified",
  PaymentCompleted: "All saga steps completed",
  PaymentFailed: "Payment saga failed",
  PaymentValidationFailed: "Validation check failed",
  InventoryReservationFailed: "Insufficient inventory",
  PaymentChargeFailed: "Payment provider rejected charge",
  NotificationFailed: "Notification delivery failed (non-critical)",
  CompensationStarted: "Rolling back completed steps",
  CompensationCompleted: "All steps compensated",
  InventoryReleased: "Inventory reservation released",
  PaymentRefunded: "Payment charge refunded",
  // Provider routing
  ProviderSelected: "Provider selected for routing",
  ProviderFallback: "Falling back to alternate provider",
  PaymentDeclined: "Payment declined by provider",
  // Fraud
  FraudCleared: "Fraud check passed",
  FraudReview: "Flagged for fraud review",
  FraudBlocked: "Blocked by fraud engine",
  // Tokenization
  CardTokenized: "Card tokenized for PCI compliance",
  TokenUsed: "Existing token used",
  // FX
  CurrencyConverted: "Currency converted via FX service",
  // Retry
  RetryScheduled: "Retry scheduled for later attempt",
  RetryAttempted: "Retry attempt in progress",
  RetryExhausted: "All retry attempts exhausted",
};

export function EventTimeline({ events }: { events: DomainEvent[] }) {
  return (
    <div className="relative">
      <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-card-border" />
      <div className="space-y-6">
        {events.map((event, i) => {
          const color = eventColors[event.eventType] ?? "bg-muted";
          const desc = eventDescriptions[event.eventType] ?? event.eventType;
          const time = new Date(event.createdAt);
          const payloadEntries = Object.entries(event.payload).filter(
            ([k]) => k !== "error",
          );
          const errorMsg = event.payload.error;

          return (
            <div key={event.id} className="relative pl-10">
              <div className={`absolute left-2.5 top-1.5 w-3 h-3 rounded-full ${color} ring-4 ring-background`} />
              <div className="bg-card border border-card-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted">v{event.version}</span>
                    <span className="font-semibold text-sm">{event.eventType}</span>
                  </div>
                  <span className="text-xs text-muted">
                    {time.toLocaleTimeString()}.{String(time.getMilliseconds()).padStart(3, "0")}
                  </span>
                </div>
                <p className="text-sm text-muted">{desc}</p>
                {errorMsg != null && (
                  <p className="text-sm text-danger mt-1">{String(errorMsg)}</p>
                )}
                {payloadEntries.length > 0 && (
                  <div className="mt-2 font-mono text-xs bg-background/50 rounded p-2 space-y-0.5">
                    {payloadEntries.map(([k, v]) => (
                      <div key={k}>
                        <span className="text-muted">{k}:</span>{" "}
                        <span className="text-foreground">
                          {typeof v === "object" ? JSON.stringify(v) : String(v)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {i < events.length - 1 && (
                  <div className="absolute left-3.5 bottom-0 translate-y-full h-6 w-0.5" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

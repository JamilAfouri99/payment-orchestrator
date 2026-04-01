"use client";

const steps = [
  { name: "Validate", events: ["PaymentValidated", "PaymentValidationFailed"] },
  { name: "Reserve Inventory", events: ["InventoryReserved", "InventoryReservationFailed"] },
  { name: "Charge Payment", events: ["PaymentCharged", "PaymentChargeFailed"] },
  { name: "Send Notification", events: ["NotificationSent", "NotificationFailed"] },
];

interface SagaFlowProps {
  completedEvents: string[];
  status: string;
}

export function SagaFlow({ completedEvents, status }: SagaFlowProps) {
  function getStepState(step: typeof steps[number]): "completed" | "failed" | "pending" | "active" {
    const successEvent = step.events[0]!;
    const failEvent = step.events[1]!;
    if (completedEvents.includes(successEvent)) return "completed";
    if (completedEvents.includes(failEvent)) return "failed";
    return "pending";
  }

  const stepStyles = {
    completed: "border-success bg-success/10 text-success",
    failed: "border-danger bg-danger/10 text-danger",
    pending: "border-card-border bg-card text-muted",
    active: "border-accent bg-accent/10 text-accent",
  };

  const connectorStyles = {
    completed: "bg-success",
    failed: "bg-danger",
    pending: "bg-card-border",
    active: "bg-accent",
  };

  return (
    <div className="flex items-center gap-0 overflow-x-auto py-4">
      {steps.map((step, i) => {
        const state = getStepState(step);
        return (
          <div key={step.name} className="flex items-center">
            <div className={`border-2 rounded-xl px-5 py-3 text-center min-w-[140px] ${stepStyles[state]}`}>
              <div className="text-xs font-mono mb-1">Step {i + 1}</div>
              <div className="text-sm font-semibold">{step.name}</div>
              <div className="text-xs mt-1 capitalize">{state}</div>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-8 h-0.5 ${connectorStyles[state]}`} />
            )}
          </div>
        );
      })}
      <div className="flex items-center">
        <div className={`w-8 h-0.5 ${status === "completed" ? "bg-success" : status === "compensated" ? "bg-warning" : "bg-card-border"}`} />
        <div className={`border-2 rounded-xl px-5 py-3 text-center min-w-[120px] ${
          status === "completed"
            ? "border-success bg-success/10 text-success"
            : status === "compensated"
            ? "border-warning bg-warning/10 text-warning"
            : status === "failed"
            ? "border-danger bg-danger/10 text-danger"
            : "border-card-border bg-card text-muted"
        }`}>
          <div className="text-xs font-mono mb-1">Result</div>
          <div className="text-sm font-semibold capitalize">{status}</div>
        </div>
      </div>
    </div>
  );
}

"use client";

const statusStyles: Record<string, string> = {
  completed: "bg-success/15 text-success border-success/30",
  failed: "bg-danger/15 text-danger border-danger/30",
  compensated: "bg-warning/15 text-warning border-warning/30",
  compensating: "bg-warning/15 text-warning border-warning/30",
  pending: "bg-muted/15 text-muted border-muted/30",
  running: "bg-accent/15 text-accent border-accent/30",
  healthy: "bg-success/15 text-success border-success/30",
  unhealthy: "bg-danger/15 text-danger border-danger/30",
};

export function StatusBadge({ status }: { status: string }) {
  const style = statusStyles[status] ?? "bg-muted/15 text-muted border-muted/30";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${style}`}>
      {status}
    </span>
  );
}

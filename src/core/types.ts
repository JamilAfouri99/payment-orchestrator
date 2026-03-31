/** All monetary values are in cents (integer) */
export type Cents = number;

export interface PaymentRequest {
  amount: Cents;
  currency: string;
  customerId: string;
  orderId: string;
  items: OrderItem[];
}

export interface OrderItem {
  productId: string;
  quantity: number;
  pricePerUnit: Cents;
}

export type PaymentStatus =
  | "pending"
  | "validating"
  | "reserving_inventory"
  | "charging"
  | "notifying"
  | "completed"
  | "failed"
  | "compensating"
  | "compensated";

export interface PaymentState {
  id: string;
  status: PaymentStatus;
  amount: Cents;
  currency: string;
  customerId: string;
  orderId: string;
  items: OrderItem[];
  error?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export type PaymentEventType =
  | "PaymentInitiated"
  | "PaymentValidated"
  | "PaymentValidationFailed"
  | "InventoryReserved"
  | "InventoryReservationFailed"
  | "PaymentCharged"
  | "PaymentChargeFailed"
  | "NotificationSent"
  | "NotificationFailed"
  | "PaymentCompleted"
  | "PaymentFailed"
  | "CompensationStarted"
  | "InventoryReleased"
  | "PaymentRefunded"
  | "CompensationCompleted";

export interface DomainEvent {
  id: string;
  aggregateId: string;
  aggregateType: string;
  eventType: PaymentEventType;
  version: number;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/** RFC 7807 Problem Details */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
}

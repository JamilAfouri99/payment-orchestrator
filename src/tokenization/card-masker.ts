const SENSITIVE_KEYS = /^(pan|card_number|cardNumber|card_num|cc_number|ccNumber|account_number)$/i;

/**
 * Recursively redacts sensitive card data from any object.
 * Ensures PAN never appears in logs, events, or API responses.
 */
export function sanitizePayload(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizePayload);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.test(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizePayload(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Masks a PAN to show only last 4 digits.
 * "4111111111111111" → "•••• •••• •••• 1111"
 */
export function maskPan(pan: string): string {
  if (pan.length < 4) return "••••";
  const last4 = pan.slice(-4);
  return `•••• •••• •••• ${last4}`;
}

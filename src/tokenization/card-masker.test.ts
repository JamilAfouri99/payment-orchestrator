import { describe, it, expect } from "vitest";
import { sanitizePayload, maskPan } from "./card-masker.js";

describe("sanitizePayload — flat objects", () => {
  it("redacts a pan field", () => {
    const result = sanitizePayload({ pan: "4111111111111111", amount: 1000 });

    expect((result as Record<string, unknown>)["pan"]).toBe("[REDACTED]");
    expect((result as Record<string, unknown>)["amount"]).toBe(1000);
  });

  it("redacts cardNumber field", () => {
    const result = sanitizePayload({ cardNumber: "4111111111111111" });

    expect((result as Record<string, unknown>)["cardNumber"]).toBe("[REDACTED]");
  });

  it("redacts card_number field", () => {
    const result = sanitizePayload({ card_number: "4111111111111111" });

    expect((result as Record<string, unknown>)["card_number"]).toBe("[REDACTED]");
  });

  it("redacts ccNumber field", () => {
    const result = sanitizePayload({ ccNumber: "4111111111111111" });

    expect((result as Record<string, unknown>)["ccNumber"]).toBe("[REDACTED]");
  });

  it("redacts account_number field", () => {
    const result = sanitizePayload({ account_number: "12345678" });

    expect((result as Record<string, unknown>)["account_number"]).toBe("[REDACTED]");
  });

  it("is case-insensitive for sensitive key matching", () => {
    const result = sanitizePayload({ PAN: "4111111111111111" });

    expect((result as Record<string, unknown>)["PAN"]).toBe("[REDACTED]");
  });

  it("preserves non-sensitive fields unchanged", () => {
    const result = sanitizePayload({ customerId: "cust_1", amount: 5000, currency: "USD" }) as Record<string, unknown>;

    expect(result["customerId"]).toBe("cust_1");
    expect(result["amount"]).toBe(5000);
    expect(result["currency"]).toBe("USD");
  });
});

describe("sanitizePayload — nested objects", () => {
  it("redacts pan from a nested card object", () => {
    const payload = { payment: { card: { pan: "4111111111111111", expiry: "12/30" } } };
    const result = sanitizePayload(payload) as Record<string, Record<string, Record<string, unknown>>>;

    expect(result["payment"]!["card"]!["pan"]).toBe("[REDACTED]");
    expect(result["payment"]!["card"]!["expiry"]).toBe("12/30");
  });

  it("redacts pan at multiple levels of nesting", () => {
    const payload = { outer: { inner: { pan: "4111111111111111" } }, pan: "4111111111119999" };
    const result = sanitizePayload(payload) as Record<string, unknown>;

    expect((result["outer"] as Record<string, Record<string, unknown>>)["inner"]!["pan"]).toBe("[REDACTED]");
    expect(result["pan"]).toBe("[REDACTED]");
  });

  it("preserves other nested fields that are not sensitive", () => {
    const payload = { metadata: { orderId: "ord_1", source: "web" } };
    const result = sanitizePayload(payload) as Record<string, Record<string, unknown>>;

    expect(result["metadata"]!["orderId"]).toBe("ord_1");
    expect(result["metadata"]!["source"]).toBe("web");
  });
});

describe("sanitizePayload — arrays", () => {
  it("redacts pan inside objects within an array", () => {
    const payload = [
      { pan: "4111111111111111", amount: 1000 },
      { pan: "4111111111119999", amount: 2000 },
    ];
    const result = sanitizePayload(payload) as Record<string, unknown>[];

    expect(result[0]!["pan"]).toBe("[REDACTED]");
    expect(result[0]!["amount"]).toBe(1000);
    expect(result[1]!["pan"]).toBe("[REDACTED]");
  });

  it("handles an array nested inside an object", () => {
    const payload = { items: [{ pan: "4111111111111111" }, { customerId: "cust_1" }] };
    const result = sanitizePayload(payload) as Record<string, Record<string, unknown>[]>;

    expect(result["items"]![0]!["pan"]).toBe("[REDACTED]");
    expect(result["items"]![1]!["customerId"]).toBe("cust_1");
  });

  it("handles an empty array without throwing", () => {
    const result = sanitizePayload([]);

    expect(result).toEqual([]);
  });
});

describe("sanitizePayload — edge values", () => {
  it("returns null unchanged", () => {
    expect(sanitizePayload(null)).toBeNull();
  });

  it("returns undefined unchanged", () => {
    expect(sanitizePayload(undefined)).toBeUndefined();
  });

  it("returns a plain string unchanged", () => {
    expect(sanitizePayload("hello")).toBe("hello");
  });

  it("returns a number unchanged", () => {
    expect(sanitizePayload(42)).toBe(42);
  });
});

describe("maskPan", () => {
  it("masks a standard 16-digit PAN showing only the last 4 digits", () => {
    expect(maskPan("4111111111111111")).toBe("•••• •••• •••• 1111");
  });

  it("preserves the correct last 4 digits for different PANs", () => {
    expect(maskPan("4111111111119999")).toBe("•••• •••• •••• 9999");
    expect(maskPan("5500005555555559")).toBe("•••• •••• •••• 5559");
  });

  it("returns •••• for a PAN shorter than 4 characters", () => {
    expect(maskPan("123")).toBe("••••");
    expect(maskPan("")).toBe("••••");
  });

  it("works with exactly 4 characters", () => {
    expect(maskPan("1234")).toBe("•••• •••• •••• 1234");
  });
});

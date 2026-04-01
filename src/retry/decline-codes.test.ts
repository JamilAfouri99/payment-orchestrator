import { describe, it, expect } from "vitest";
import {
  getDeclineCode,
  getAllDeclineCodes,
  classifyDecline,
  isHardDecline,
} from "./decline-codes.js";

describe("getDeclineCode", () => {
  it("returns the definition for a known hard decline code", () => {
    const def = getDeclineCode("fraud_suspected");

    expect(def).toBeDefined();
    expect(def!.code).toBe("fraud_suspected");
    expect(def!.category).toBe("hard");
  });

  it("returns the definition for a known soft decline code", () => {
    const def = getDeclineCode("processor_unavailable");

    expect(def).toBeDefined();
    expect(def!.category).toBe("soft");
    expect(def!.retryable).toBe(true);
  });

  it("returns the definition for a known retriable decline code", () => {
    const def = getDeclineCode("insufficient_funds");

    expect(def).toBeDefined();
    expect(def!.category).toBe("retriable");
    expect(def!.suggestedAction).toBe("retry_later");
  });

  it("returns undefined for an unrecognised code", () => {
    expect(getDeclineCode("completely_unknown_code")).toBeUndefined();
  });
});

describe("classifyDecline", () => {
  it("classifies fraud_suspected as hard", () => {
    expect(classifyDecline("fraud_suspected")).toBe("hard");
  });

  it("classifies stolen_card as hard", () => {
    expect(classifyDecline("stolen_card")).toBe("hard");
  });

  it("classifies card_blocked as hard", () => {
    expect(classifyDecline("card_blocked")).toBe("hard");
  });

  it("classifies invalid_account as hard", () => {
    expect(classifyDecline("invalid_account")).toBe("hard");
  });

  it("classifies processor_unavailable as soft", () => {
    expect(classifyDecline("processor_unavailable")).toBe("soft");
  });

  it("classifies timeout as soft", () => {
    expect(classifyDecline("timeout")).toBe("soft");
  });

  it("classifies rate_limited as soft", () => {
    expect(classifyDecline("rate_limited")).toBe("soft");
  });

  it("classifies do_not_honor as soft", () => {
    expect(classifyDecline("do_not_honor")).toBe("soft");
  });

  it("classifies insufficient_funds as retriable", () => {
    expect(classifyDecline("insufficient_funds")).toBe("retriable");
  });

  it("classifies expired_card as retriable", () => {
    expect(classifyDecline("expired_card")).toBe("retriable");
  });

  it("classifies temporary_hold as retriable", () => {
    expect(classifyDecline("temporary_hold")).toBe("retriable");
  });

  it("defaults unknown codes to soft", () => {
    expect(classifyDecline("xyz_unknown")).toBe("soft");
  });
});

describe("isHardDecline", () => {
  it("returns true for hard decline codes", () => {
    expect(isHardDecline("fraud_suspected")).toBe(true);
    expect(isHardDecline("stolen_card")).toBe(true);
    expect(isHardDecline("card_blocked")).toBe(true);
    expect(isHardDecline("invalid_account")).toBe(true);
  });

  it("returns false for soft decline codes", () => {
    expect(isHardDecline("processor_unavailable")).toBe(false);
    expect(isHardDecline("timeout")).toBe(false);
  });

  it("returns false for retriable decline codes", () => {
    expect(isHardDecline("insufficient_funds")).toBe(false);
    expect(isHardDecline("expired_card")).toBe(false);
  });

  it("returns false for unknown codes (defaults to soft)", () => {
    expect(isHardDecline("completely_made_up")).toBe(false);
  });
});

describe("getAllDeclineCodes", () => {
  it("returns a non-empty list of decline codes", () => {
    const codes = getAllDeclineCodes();
    expect(codes.length).toBeGreaterThan(0);
  });

  it("every code has a valid category", () => {
    const validCategories = new Set(["hard", "soft", "retriable"]);
    for (const def of getAllDeclineCodes()) {
      expect(validCategories.has(def.category)).toBe(true);
    }
  });

  it("every code has a valid suggestedAction", () => {
    const validActions = new Set(["block", "retry_alternate", "retry_same", "retry_later"]);
    for (const def of getAllDeclineCodes()) {
      expect(validActions.has(def.suggestedAction)).toBe(true);
    }
  });

  it("hard decline codes are never retryable and have maxRetries 0", () => {
    for (const def of getAllDeclineCodes().filter((d) => d.category === "hard")) {
      expect(def.retryable).toBe(false);
      expect(def.maxRetries).toBe(0);
    }
  });

  it("every code string is non-empty", () => {
    for (const def of getAllDeclineCodes()) {
      expect(def.code.length).toBeGreaterThan(0);
    }
  });

  it("returns a copy — mutating the result does not affect internal state", () => {
    const first = getAllDeclineCodes();
    const second = getAllDeclineCodes();
    first.pop();
    expect(getAllDeclineCodes().length).toBe(second.length);
  });
});

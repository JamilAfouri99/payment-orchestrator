import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("hashPassword", () => {
  it("returns a string that is not the original password", async () => {
    const hash = await hashPassword("my-secret-password");

    expect(hash).not.toBe("my-secret-password");
  });

  it("produces output that looks like a bcrypt hash ($2a$ or $2b$ prefix)", async () => {
    const hash = await hashPassword("my-secret-password");

    expect(hash).toMatch(/^\$2[ab]\$/);
  });

  it("produces different hashes for the same password on repeated calls", async () => {
    const hash1 = await hashPassword("same-password");
    const hash2 = await hashPassword("same-password");

    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different passwords", async () => {
    const hash1 = await hashPassword("password-one");
    const hash2 = await hashPassword("password-two");

    expect(hash1).not.toBe(hash2);
  });
});

describe("verifyPassword", () => {
  it("returns true when the password matches the hash", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");

    const result = await verifyPassword("correct-horse-battery-staple", hash);

    expect(result).toBe(true);
  });

  it("returns false when the password does not match the hash", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");

    const result = await verifyPassword("wrong-password", hash);

    expect(result).toBe(false);
  });
});

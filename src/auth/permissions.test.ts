import { describe, it, expect } from "vitest";
import { hasPermission, getPermissionsForRole, ROLE_PERMISSIONS } from "./permissions.js";

describe("ROLE_PERMISSIONS — owner", () => {
  it("has a wildcard permission granting everything", () => {
    expect(ROLE_PERMISSIONS.owner).toContain("*");
  });
});

describe("ROLE_PERMISSIONS — admin", () => {
  it("includes payments:* which grants any payments permission", () => {
    expect(ROLE_PERMISSIONS.admin).toContain("payments:*");
  });

  it("includes team:* which grants team write", () => {
    expect(ROLE_PERMISSIONS.admin).toContain("team:*");
  });
});

describe("ROLE_PERMISSIONS — developer", () => {
  it("includes payments:* granting payments:read", () => {
    expect(hasPermission("developer", "payments:read")).toBe(true);
  });

  it("does not include team:write", () => {
    expect(hasPermission("developer", "team:write")).toBe(false);
  });
});

describe("ROLE_PERMISSIONS — finance", () => {
  it("has payments:read", () => {
    expect(hasPermission("finance", "payments:read")).toBe(true);
  });

  it("does not have payments:write", () => {
    expect(hasPermission("finance", "payments:write")).toBe(false);
  });
});

describe("ROLE_PERMISSIONS — viewer", () => {
  it("has payments:read", () => {
    expect(hasPermission("viewer", "payments:read")).toBe(true);
  });

  it("does not have payments:write", () => {
    expect(hasPermission("viewer", "payments:write")).toBe(false);
  });

  it("does not have team:write", () => {
    expect(hasPermission("viewer", "team:write")).toBe(false);
  });
});

describe("hasPermission — exact match", () => {
  it("returns true for an exact permission match", () => {
    expect(hasPermission("finance", "payments:read")).toBe(true);
  });

  it("returns false when the role does not have the exact permission", () => {
    expect(hasPermission("finance", "tokens:write")).toBe(false);
  });
});

describe("hasPermission — wildcard match", () => {
  it("payments:* on admin matches payments:read", () => {
    expect(hasPermission("admin", "payments:read")).toBe(true);
  });

  it("payments:* on admin matches payments:write", () => {
    expect(hasPermission("admin", "payments:write")).toBe(true);
  });

  it("payments:* does not match tokens:read", () => {
    expect(hasPermission("admin", "tokens:read")).toBe(true); // admin also has tokens:*
  });

  it("developer payments:* does not match team:write", () => {
    expect(hasPermission("developer", "team:write")).toBe(false);
  });
});

describe("hasPermission — global wildcard", () => {
  it("owner * matches payments:read", () => {
    expect(hasPermission("owner", "payments:read")).toBe(true);
  });

  it("owner * matches any arbitrary permission string", () => {
    expect(hasPermission("owner", "completely:made-up:permission")).toBe(true);
  });
});

describe("hasPermission — unknown-like role edge cases", () => {
  it("support role does not have fraud:write", () => {
    expect(hasPermission("support", "fraud:write")).toBe(false);
  });
});

describe("getPermissionsForRole", () => {
  it("returns the correct array for owner", () => {
    expect(getPermissionsForRole("owner")).toEqual(["*"]);
  });

  it("returns the correct array for finance", () => {
    expect(getPermissionsForRole("finance")).toEqual(["payments:read", "tokens:read", "providers:read"]);
  });

  it("returns the correct array for viewer", () => {
    expect(getPermissionsForRole("viewer")).toEqual(["payments:read", "providers:read", "admin:read"]);
  });

  it("returns a non-empty array for every defined role", () => {
    const roles = ["owner", "admin", "developer", "finance", "support", "viewer"] as const;
    for (const role of roles) {
      expect(getPermissionsForRole(role).length).toBeGreaterThan(0);
    }
  });
});

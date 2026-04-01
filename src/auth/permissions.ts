export type Role = "owner" | "admin" | "developer" | "finance" | "support" | "viewer";

export type Permission = string;

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ["*"],
  admin: [
    "payments:*",
    "webhooks:*",
    "fraud:*",
    "tokens:*",
    "providers:*",
    "api-keys:*",
    "team:*",
    "admin:*",
  ],
  developer: [
    "payments:*",
    "webhooks:*",
    "api-keys:read",
    "api-keys:create",
    "providers:read",
    "admin:read",
    "fraud:read",
  ],
  finance: ["payments:read", "tokens:read", "providers:read"],
  support: ["payments:read", "tokens:read", "webhooks:read"],
  viewer: ["payments:read", "providers:read", "admin:read"],
};

// Maps route patterns to required permissions for reference by middleware
export const ROUTE_PERMISSIONS: Record<string, Permission> = {
  "POST /payments": "payments:write",
  "GET /payments": "payments:read",
  "GET /admin/fraud/rules": "fraud:read",
  "POST /admin/fraud/rules": "fraud:write",
  "PUT /admin/fraud/rules/:id": "fraud:write",
  "DELETE /admin/fraud/rules/:id": "fraud:write",
  "GET /admin/providers": "providers:read",
  "POST /webhooks/register": "webhooks:write",
  "GET /webhooks/registrations": "webhooks:read",
  "GET /tokens": "tokens:read",
  "POST /tokens/revoke/:token": "tokens:write",
  "GET /admin/chaos": "admin:read",
  "POST /admin/chaos": "admin:write",
};

/**
 * Checks whether a role grants the requested permission.
 * Supports wildcards: "*" grants everything, "payments:*" grants any "payments:" permission.
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const granted = ROLE_PERMISSIONS[role];
  return granted.some((g) => matchesPermission(g, permission));
}

export function getPermissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role];
}

function matchesPermission(granted: Permission, requested: Permission): boolean {
  if (granted === "*") return true;
  if (granted === requested) return true;

  if (granted.endsWith(":*")) {
    const prefix = granted.slice(0, -1); // "payments:"
    return requested.startsWith(prefix);
  }

  return false;
}

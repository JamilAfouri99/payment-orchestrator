export interface TenantContext {
  tenantId: string;
  merchantAccountId?: string | undefined;
  environment: "sandbox" | "production";
  plan: string;
  userId?: string | undefined;
  userRole?: string | undefined;
}

export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

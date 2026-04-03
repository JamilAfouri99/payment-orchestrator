import type { Request, Response } from "express";
import type { ProblemDetails } from "../core/types.js";
import { DEFAULT_TENANT_ID } from "../tenancy/tenant-context.js";

export function respondProblem(res: Response, status: number, title: string, detail: string): void {
  const problem: ProblemDetails = {
    type: `https://payment-orchestrator.dev/problems/${title.toLowerCase().replace(/\s+/g, "-")}`,
    title,
    status,
    detail,
  };
  res.status(status).json(problem);
}

export function respondFromError(
  res: Response,
  error: { code: string; message: string },
): void {
  const statusMap: Record<string, number> = {
    VALIDATION: 400,
    NOT_FOUND: 404,
    SAGA_FAILED: 422,
    FRAUD_BLOCKED: 403,
    INTERNAL: 500,
  };
  const status = statusMap[error.code] ?? 500;
  respondProblem(res, status, error.code, error.message);
}

export function getTenantId(req: Request): string {
  return req.tenantContext?.tenantId ?? DEFAULT_TENANT_ID;
}

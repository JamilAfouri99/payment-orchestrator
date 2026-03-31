import type { Request, Response, NextFunction } from "express";
import type { ProblemDetails } from "../core/types.js";

/**
 * Express error handler that returns RFC 7807 Problem Details responses.
 * Must be the last middleware registered.
 */
export function errorHandler(error: Error, _req: Request, res: Response, _next: NextFunction): void {
  const problem: ProblemDetails = {
    type: "https://payment-orchestrator.dev/problems/internal",
    title: "Internal Server Error",
    status: 500,
    detail: error.message,
  };

  res.status(500).json(problem);
}

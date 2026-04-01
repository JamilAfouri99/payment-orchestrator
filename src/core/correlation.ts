import type { Request, Response, NextFunction } from "express";
import { v4 as uuid } from "uuid";

const HEADER_NAME = "x-request-id";

/**
 * Express middleware that ensures every request has a correlation ID.
 * Reads from the X-Request-ID header or generates a new UUID.
 * Sets the ID on both the request and response.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers[HEADER_NAME] as string | undefined) ?? uuid();
  req.headers[HEADER_NAME] = correlationId;
  res.setHeader(HEADER_NAME, correlationId);
  next();
}

/**
 * Extracts the correlation ID from a request.
 * @param req - Express request
 * @returns The correlation ID string
 */
export function getCorrelationId(req: Request): string {
  return (req.headers[HEADER_NAME] as string) ?? "unknown";
}

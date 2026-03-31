import type { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import type { ProblemDetails } from "../core/types.js";

/**
 * Creates Express middleware that enforces idempotency via the Idempotency-Key header.
 * Same key returns the cached response without reprocessing.
 * Keys expire after the configured TTL.
 * @param prisma - PrismaClient instance
 * @param ttlMs - Time-to-live for idempotency keys in milliseconds
 * @returns Express middleware function
 */
export function createIdempotencyMiddleware(prisma: PrismaClient, ttlMs: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const idempotencyKey = req.headers["idempotency-key"];

    if (!idempotencyKey || typeof idempotencyKey !== "string") {
      const problem: ProblemDetails = {
        type: "https://payment-orchestrator.dev/problems/missing-idempotency-key",
        title: "Missing Idempotency-Key",
        status: 400,
        detail: "The Idempotency-Key header is required for this endpoint.",
      };
      res.status(400).json(problem);
      return;
    }

    try {
      const existing = await prisma.idempotencyKey.findUnique({
        where: { key: idempotencyKey },
      });

      if (existing) {
        if (existing.expiresAt < new Date()) {
          await prisma.idempotencyKey.delete({ where: { key: idempotencyKey } });
        } else {
          res.status(existing.statusCode).json(existing.response);
          return;
        }
      }

      const originalJson = res.json.bind(res);
      res.json = function (body: unknown) {
        const statusCode = res.statusCode;
        prisma.idempotencyKey
          .create({
            data: {
              key: idempotencyKey,
              response: JSON.parse(JSON.stringify(body)),
              statusCode,
              expiresAt: new Date(Date.now() + ttlMs),
            },
          })
          .catch(() => {
            // Race condition: another request with same key — safe to ignore
          });
        return originalJson(body);
      };

      next();
    } catch {
      next();
    }
  };
}

import type { Request, Response, NextFunction } from "express";
import type { Logger } from "../core/logger.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";
import { getCorrelationId } from "../core/correlation.js";

/**
 * Express middleware that logs every request/response with timing and correlation ID.
 * @param logger - Structured logger
 * @param metrics - Metrics collector for request counters
 * @returns Express middleware
 */
export function requestLoggerMiddleware(logger: Logger, metrics: MetricsCollector) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    const correlationId = getCorrelationId(req);

    res.on("finish", () => {
      const durationMs = Date.now() - start;
      const method = req.method;
      const path = req.route?.path ?? req.path;
      const status = res.statusCode;

      logger.info("request", {
        correlationId,
        method,
        path,
        status,
        durationMs,
      });

      metrics.increment("http_requests_total", { method, status: String(status) });
      metrics.recordDuration("http_request_duration_ms", durationMs, { method, path });
    });

    next();
  };
}

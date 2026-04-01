export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  paymentId?: string;
  sagaId?: string;
  step?: string;
  durationMs?: number;
  [key: string]: unknown;
}

const LOG_BUFFER_SIZE = 500;
const logBuffer: LogEntry[] = [];

/**
 * Creates a structured JSON logger that writes to stdout and retains recent entries in memory.
 * @param context - Default fields included in every log entry
 * @returns Logger with level methods
 */
export function createLogger(context: Record<string, unknown> = {}) {
  function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
      ...fields,
    };

    logBuffer.push(entry);
    if (logBuffer.length > LOG_BUFFER_SIZE) {
      logBuffer.shift();
    }

    const output = JSON.stringify(entry);
    if (level === "error" || level === "warn") {
      process.stderr.write(output + "\n");
    } else {
      process.stdout.write(output + "\n");
    }
  }

  return {
    debug: (msg: string, fields?: Record<string, unknown>) => log("debug", msg, fields),
    info: (msg: string, fields?: Record<string, unknown>) => log("info", msg, fields),
    warn: (msg: string, fields?: Record<string, unknown>) => log("warn", msg, fields),
    error: (msg: string, fields?: Record<string, unknown>) => log("error", msg, fields),
  };
}

export type Logger = ReturnType<typeof createLogger>;

/**
 * Returns the most recent log entries from the in-memory buffer.
 * @param limit - Max entries to return (default: 100)
 * @returns Recent log entries, newest first
 */
export function getRecentLogs(limit: number = 100): LogEntry[] {
  return logBuffer.slice(-limit).reverse();
}

/** Clears the in-memory log buffer. Used in tests. */
export function clearLogBuffer(): void {
  logBuffer.length = 0;
}

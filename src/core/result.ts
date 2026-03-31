/**
 * Discriminated union representing either success or failure.
 * Used throughout the codebase instead of throwing exceptions in business logic.
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

/** @returns A successful Result wrapping the given value */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** @returns A failed Result wrapping the given error */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Unwraps a Result, returning the value or throwing the error.
 * Only use at system boundaries (e.g., HTTP handlers), never in business logic.
 * @param result - The Result to unwrap
 * @returns The contained value
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error instanceof Error ? result.error : new Error(String(result.error));
}

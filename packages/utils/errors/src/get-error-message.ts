/**
 * getErrorMessage — W-F13 (as-any remediation, quick win)
 *
 * Single source of truth for turning an unknown thrown value into a readable
 * message. Kills the `(err as any)?.message` spread (22 web call sites).
 *
 * Precedence:
 *   1. AppError / Error `.message` (if it's a real Error instance)
 *   2. A non-Error object with a `message` string property
 *   3. String(err) — covers strings, numbers, and opaque values safely
 *      (never rethrows, never returns undefined).
 */
export function getErrorMessage(error: unknown): string {
  if (error === undefined || error === null) {
    return "Unknown error";
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object") {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  const fallback = String(error);
  return fallback.length > 0 ? fallback : "Unknown error";
}

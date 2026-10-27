/**
 * A bounded `fetch` for oRPC calls.
 *
 * ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
 * A plain `fetch` has NO timeout. When the ingress changes owner during the
 * setup→platform handover, an in-flight request opens a socket that is neither
 * answered nor closed: the client sits in `fetching` forever, TanStack Query
 * keeps it in `pending`, and the wizard's final screen waits on a promise that
 * can never settle. The setup container exits moments later, so nothing will
 * ever answer it. The operator sees a spinner with no error and no retry —
 * "stuck on the last screen".
 *
 * A socket that never resolves is indistinguishable from a slow one, so the
 * client has to impose the deadline itself. `AbortSignal.timeout` rejects with
 * `TimeoutError`, which TanStack treats as a FAILED query and retries, which is
 * exactly the behaviour wanted: the next attempt lands after the new ingress is
 * serving.
 *
 * ── WHY STREAMS ARE EXEMPT ──────────────────────────────────────────────────
 * The SSE progress stream is a request that is SUPPOSED to stay open. A blanket
 * timeout would abort every long provisioning run at the deadline — turning the
 * fix into a worse bug. Streams are therefore detected and left alone:
 *
 *   - the link passes its own `AbortSignal` (its lifecycle owns the connection),
 *   - the request accepts `text/event-stream`.
 *
 * The stream has its OWN liveness rule (`inactivityTimeoutMs` in
 * `@deployer/orpc-utils`), which is the correct one for it: a heartbeat every 3s
 * proves the socket alive, so silence — not elapsed time — is what kills it.
 *
 * ── WHY `AbortSignal.any` RATHER THAN REPLACING THE SIGNAL ──────────────────
 * Replacing a caller's signal would break cancellation: an unmounted component
 * could no longer abort its own request. `any` keeps BOTH — the caller's abort
 * still works, and the deadline is added on top.
 */

/** Deadline for an ordinary oRPC call. Generous: a cold route can take seconds. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Headers whose presence means "this connection is meant to stay open". */
function isStreamingRequest(init: RequestInit | undefined): boolean {
  // The oRPC streaming plugin supplies its own signal. Respecting it as the
  // ownership marker is exact — a caller passing a signal for an ordinary call is
  // already opting into manual lifecycle management, so imposing a second
  // deadline on top would fight it.
  if (init?.signal !== undefined && init.signal !== null) return true;
  const accept = new Headers(init?.headers).get("accept");
  return accept !== null && accept.includes("text/event-stream");
}

/**
 * `fetch` with a deadline, used by every oRPC link.
 *
 * `timeoutMs` is per-call so a caller that genuinely waits longer (a long
 * mutation) can raise it without disabling the guard everywhere.
 *
 * ── WHY THE RETURN TYPE IS NOT `typeof fetch` ───────────────────────────────
 * Bun's global `fetch` carries extra static members (`preconnect`), and a plain
 * arrow function does not, so annotating this as `typeof fetch` fails:
 *
 *   Property 'preconnect' is missing in type '(…) => Promise<Response>'
 *     but required in type 'typeof fetch'
 *
 * oRPC's link option is typed `typeof fetch`, so the wrapper must BE that shape.
 * Bun's `fetch` carries a static `preconnect`, and a wrapper that only forwards
 * calls does not — hence the explicit return type below and the single
 * `Object.assign` that carries the original through untouched. `preconnect` is
 * a hint about a future connection, not a request, so bounding it would be
 * meaningless; forwarding the real one is the honest answer.
 */
export type FetchLike = typeof fetch;

/**
 * The call signature only — what a caller can actually hand over.
 *
 * Separate from `FetchLike` because the two directions differ: a CALLER may pass
 * any `(input, init) => Promise<Response>` (an arrow wrapper around the global
 * is the normal case, and it has no `preconnect`), while the RETURN has to satisfy
 * oRPC's `typeof fetch`. Using one type for both made every caller fail to
 * compile; splitting them is what makes the wrapper usable and the result honest.
 */
export type FetchCall = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function fetchWithTimeout(fetchImpl: FetchCall, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS): FetchLike {
  const bounded = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (isStreamingRequest(init)) return fetchImpl(input, init);

    const deadline = AbortSignal.timeout(timeoutMs);
    return fetchImpl(input, {
      ...init,
      signal: init?.signal !== undefined && init.signal !== null ? AbortSignal.any([init.signal, deadline]) : deadline,
    });
  }) as FetchLike;

  // Carries `preconnect` (and any future static member) through unchanged when the
  // input has one, so the result genuinely satisfies `typeof fetch` instead of
  // merely being asserted to. An arrow wrapper has none, which is fine: nothing in
  // the oRPC call path reads it.
  return Object.assign(bounded, fetchImpl);
}

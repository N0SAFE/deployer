import type { Request, Response, NextFunction, RequestHandler } from "express";
import * as http from "node:http";
import { logger } from "@repo/logger";

const log = logger.scope("SetupAuthProxy");

/**
 * The Better Auth surface, served by the API but reached through the SETUP host.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The wizard's final step signs the operator in as the admin that onboarding
 * just created. Its client is configured with `basePath: "/api/auth"` and NO
 * `baseURL` (see `views/lib/auth.ts`), so the browser resolves that against
 * whatever origin served the page — which during onboarding is `setup.<host>`.
 *
 * Nothing served `/api/auth` there, so the request 404'd:
 *
 *   Cannot POST /api/auth/sign-in/email
 *
 * ── WHY A PROXY AND NOT A REDIRECT ───────────────────────────────────────────
 * Better Auth answers with a session COOKIE, and the whole point of keeping the
 * wizard on one origin is that the cookie is set for the domain the operator is
 * already on. Redirecting to `api.<host>` would set it on a different host, and
 * the very next `/setup/trigger` call from the page would arrive unauthenticated.
 * Proxying keeps a single origin from the browser's point of view, so the cookie
 * is written for `setup.<host>` (the same registrable domain it becomes after
 * the handover) and every subsequent call carries it.
 *
 * ── WHY `http.request` AND NOT `fetch` ───────────────────────────────────────
 * The response must be streamed byte-for-byte, headers included: Better Auth
 * sets `Set-Cookie` (possibly several), and re-serializing through `fetch` would
 * lose both the multi-value headers and the exact framing. This is the same
 * reasoning as `@repo/vite-assets`.
 */
export const SETUP_AUTH_PREFIX = "/api/auth";

/**
 * Build the middleware.
 *
 * `target` is the API's base URL (`SETUP_API_URL`). It is REQUIRED rather than
 * defaulted: a wrong value here fails as a 404 on sign-in, which reads as an
 * auth misconfiguration rather than as a proxy pointed at the wrong host.
 */
export function createSetupAuthProxy(target: string): RequestHandler {
  const url = new URL(target);

  return (req: Request, res: Response, next: NextFunction): void => {
    const path = req.url ?? "/";
    if (!path.startsWith(SETUP_AUTH_PREFIX)) {
      next();
      return;
    }

    const headers: Record<string, string | string[] | undefined> = { ...req.headers };
    // The upstream must see ITS OWN host, not the setup host: Better Auth builds
    // absolute callback URLs (and origin checks) from the inbound Host header.
    headers.host = url.host;

    const upstream = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path,
        method: req.method,
        headers,
      },
      (upstreamRes) => {
        // `writeHead` with the raw headers array preserves EVERY `Set-Cookie`,
        // which an object merge would collapse to one.
        const raw: string[] = [];
        for (const [name, value] of Object.entries(upstreamRes.headers)) {
          if (value === undefined) continue;
          for (const entry of Array.isArray(value) ? value : [value]) {
            raw.push(name, entry);
          }
        }
        res.writeHead(upstreamRes.statusCode ?? 502, raw);
        upstreamRes.pipe(res);
      },
    );

    upstream.on("error", (error: Error) => {
      // The API is not up yet — an EXPECTED state during onboarding, since it
      // starts behind the gate. Answering 503 lets the wizard render it as
      // progress rather than as a fault, which is the same contract the oRPC
      // proxy uses for the same condition.
      log.warn(`Auth proxy unavailable for ${path}: ${error.message}`);
      if (res.headersSent) {
        res.end();
        return;
      }
      res
        .status(503)
        .type("application/json")
        .send(
          JSON.stringify({
            message: `The platform API is not reachable yet (${url.host}${SETUP_AUTH_PREFIX})`,
          }),
        );
    });

    // Body forwarding: the parsed JSON must be re-sent, because Express has
    // already consumed the request stream by the time this middleware runs.
    if (req.body !== undefined && req.body !== null && Object.keys(req.body).length > 0) {
      upstream.write(JSON.stringify(req.body));
    }
    upstream.end();
  };
}

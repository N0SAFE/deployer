import type { RequestHandler } from "express";
import { logger } from "@repo/logger";

import {
  createViteAssetsProxy,
  isViteAssetRequest,
  resolveViteDevServerUrl,
} from "./vite-assets-proxy";

const log = logger.scope("ViteAssetsMiddleware");

/**
 * Express middleware that serves an SSR app's client bundle in dev.
 *
 * ── WHY THIS IS A PACKAGE AND NOT PART OF ONE APP ───────────────────────────
 * BOTH SSR apps — `apps/api` and `apps/setup` — serve React views, and both need
 * their client bundle proxied to a standalone Vite dev server. The mechanism is
 * identical; only the PORT differs (the API's Vite runs on 5173, setup's on 5174,
 * because both processes run at once during onboarding).
 *
 * That is the §8.7 split exactly: the mechanism is shared, the app-specific data
 * arrives as a PARAMETER (`port`) or an env override. An earlier version lived in
 * `apps/api` and hardcoded port 5173, which is why the setup wizard rendered
 * inert — its assets 404'd against the API's port.
 *
 * ── WHY IT IS DEV-ONLY AND FAIL-CLOSED ──────────────────────────────────────
 * In production the client bundle is a real file served by Nest's static
 * handler, so a request for `/vite/...` there means the template is wrong.
 * Answering with a proxy to a dev server that does not exist is the condition
 * the old gateway expressed as a 503 "Vite dev server unavailable" — better to
 * name the misconfiguration (404 + a WARN) than to hide it behind a proxy error.
 *
 * Mounted BEFORE Nest's router, because the assets are not app routes — they
 * must not reach the ORPC/controller layer, and they must not be subject to the
 * app's auth guard (they are static build output, identical for every user).
 */
export function createViteAssetsMiddleware(options: {
  /**
   * Port the app's OWN Vite dev server listens on.
   *
   * Required rather than defaulted: a wrong default is silent — the page renders
   * and every asset 404s — so making each app state its port turns a runtime
   * mystery into a one-line read.
   */
  port: number;
  /** Overrides `VITE_DEV_SERVER_URL`; mainly for tests and non-standard setups. */
  devServerUrl?: string;
}): RequestHandler {
  const proxy = createViteAssetsProxy(
    options.devServerUrl ?? resolveViteDevServerUrl(options.port),
  );

  return (req, res, next) => {
    if (!isViteAssetRequest(req.path)) {
      next();
      return;
    }

    if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test") {
      // Explicit, not silent: a `/vite/...` request in production is a
      // configuration error worth seeing in the logs rather than a 404 that
      // looks like a typo in a URL.
      log.warn(`Refusing to proxy Vite asset in ${String(process.env.NODE_ENV)}: ${req.path}`);
      res.status(404).json({ statusCode: 404, message: "Vite assets are unavailable", path: req.path });
      return;
    }

    proxy(req, res, next);
  };
}

export {
  createViteAssetsProxy,
  isViteAssetRequest,
  toViteBasePath,
  VITE_ASSETS_PREFIX,
} from "./vite-assets-proxy";
export type { RequestHandler };

import type { RequestHandler } from "express";
import { logger } from "@repo/logger";

import {
  createViteAssetsProxy,
  isViteAssetRequest,
  resolveViteDevServerUrl,
} from "./vite-assets-proxy";

const log = logger.scope("ViteAssetsMiddleware");

/**
 * Express middleware that serves the SSR views' client bundle in dev.
 *
 * WHY THIS EXISTS AS ITS OWN MIDDLEWARE
 * The API used to reach the Vite dev server through the GATEWAY's catch-all,
 * which proxied to sub-apps. The sub-app pipeline is gone (the API now boots as
 * one normal Nest application), but the SSR views still need their assets in
 * dev — so the behaviour is kept and the sub-app machinery around it is not.
 *
 * `dev` ONLY, and fail-closed. In production the client bundle is a real file
 * served by Nest's static handler, so a request for `/vite/...` there means the
 * template is wrong; answering with a proxy to a dev server that does not exist
 * is exactly the condition the old gateway expressed as a 503 "Vite dev server
 * unavailable".
 *
 * Mounted BEFORE Nest's router, because the assets are not API routes — they
 * must not reach the ORPC/controller layer, and they must not be subject to the
 * app's auth guard (they are static build output, identical for every user).
 */
export function createViteAssetsMiddleware(): RequestHandler {
  const proxy = createViteAssetsProxy(resolveViteDevServerUrl());

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

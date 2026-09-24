/**
 * Gateway — Catch-all middleware for the gateway Express server.
 *
 * The gateway is a thin Express app that:
 *   1. Proxies requests to sub-apps based on a dynamic route graph
 *   2. Returns 503 if no sub-app handles the route yet (starting)
 *   3. Returns 502/504 on proxy errors
 *
 * Usage:
 *   import { createGatewayCatchAll } from './core/gateway/gateway';
 *   import { RouteRegistryService } from './core/gateway/route-registry.service';
 *
 *   const registry = new RouteRegistryService();
 *   const gateway = express();
 *   gateway.all('*', createGatewayCatchAll(registry));
 *
 * The registry is populated by sub-apps as they start:
 *   registry.register({ id: 'health', port: 3010, routes: [...] });
 */

import type { Request, Response, NextFunction } from 'express';
import * as http from 'node:http';
import { logger } from '@repo/logger';
import { RouteRegistryService } from './route-registry.service';
import { isViteAssetRequest, resolveViteDevServerUrl, toViteBasePath } from './vite-assets-proxy';

const log = logger.scope('Gateway');

/**
 * Create an Express catch-all middleware that proxies requests to registered
 * sub-apps based on the route registry's routing graph.
 */
export function createGatewayCatchAll(
  registry: RouteRegistryService,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, _next: NextFunction) => {
    handleProxy(req, res, registry).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Gateway error: ${message}`);
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ statusCode: 502, message: 'Bad Gateway' }));
      }
    });
  };
}

async function handleProxy(
  req: Request,
  res: Response,
  registry: RouteRegistryService,
): Promise<void> {
  const method = req.method;
  const path = req.url;

  // ── Vite dev assets are EXEMPT from the 503 "no sub-app" guard ──
  // They are SSR build artifacts served under the single `/vite/` base by a
  // standalone dev server, not sub-app routes — the registry can never match
  // them, so without this exemption the setup page loads without its bundle.
  if (isViteAssetRequest(path)) {
    proxyViteAsset(req, res, path);
    return;
  }

  // Try to match against registered routes
  const match = registry.match(method, path);

  if (!match) {
    log.warn(`No sub-app registered for ${method} ${path}`);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      statusCode: 503,
      message: 'Service not yet available — no sub-app registered for this route',
      path,
      method,
    }));
    return;
  }

  log.debug(`Proxying ${method} ${path} → ${match.targetUrl} (${match.subAppId})`);

  // Proxy the request to the matching sub-app
  await proxyRequest(req, res, match.targetUrl);
}

/**
 * Stream a Vite dev asset from the standalone dev server, rewriting the path
 * onto the Vite base (the SSR library emits root-absolute paths that Vite only
 * serves under its base).
 */
function proxyViteAsset(req: Request, res: Response, path: string): void {
  if ((path.split('?')[0] ?? path) === '/favicon.ico') {
    res.statusCode = 204;
    res.end();
    return;
  }
  const target = new URL(resolveViteDevServerUrl());
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: toViteBasePath(path),
      method: req.method,
      headers: { ...req.headers, host: target.host },
      timeout: 30_000,
    },
    (upstreamRes) => {
      if (!res.headersSent) {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      }
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', (error: Error) => {
    log.warn(`Vite asset proxy unavailable for ${path}: ${error.message}`);
    if (!res.headersSent) {
      res.statusCode = 503;
      res.end(JSON.stringify({ statusCode: 503, message: 'Vite dev server unavailable', path }));
    }
  });
  req.pipe(upstream);
}

/**
 * Proxy an HTTP request to the target sub-app using Node's native http module.
 */
function proxyRequest(
  req: Request,
  res: Response,
  targetUrl: string,
): Promise<void> {
  return new Promise((resolve) => {
    try {
      const url = new URL(targetUrl);

      const proxyOptions: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: req.method,
        headers: {
          ...req.headers,
          'x-forwarded-host': req.headers.host ?? '',
          'x-forwarded-proto': 'http',
          connection: undefined,
        },
        timeout: 30_000,
      };

      const proxyReq = http.request(proxyOptions, (proxyRes) => {
        res.statusCode = proxyRes.statusCode ?? 500;

        // Forward response headers
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (value !== undefined) {
            res.setHeader(key, Array.isArray(value) ? value : value);
          }
        }

        // Stream response body
        proxyRes.pipe(res, { end: true });
        proxyRes.on('end', () => resolve());
      });

      proxyReq.on('error', (err: NodeJS.ErrnoException) => {
        log.error(`Proxy error to ${targetUrl}: ${err.message}`);
        if (!res.headersSent) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            statusCode: 502,
            message: `Bad Gateway: ${err.message}`,
          }));
        }
        resolve();
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        if (!res.headersSent) {
          res.statusCode = 504;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            statusCode: 504,
            message: 'Gateway Timeout — sub-app did not respond in time',
          }));
        }
        resolve();
      });

      // Stream request body to target
      if (req.readable) {
        req.pipe(proxyReq, { end: true });
      } else {
        proxyReq.end();
      }
    } catch (err: any) {
      log.error(`Proxy setup failed for ${targetUrl}: ${err.message}`);
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          statusCode: 502,
          message: `Bad Gateway: ${err.message}`,
        }));
      }
      resolve();
    }
  });
}

/**
 * ExpressRouteExtractor — Reads the Express router stack from a running NestJS
 * application and extracts all registered HTTP routes (method + path).
 *
 * After a NestJS HTTP app calls app.init() (or app.listen()), Express's
 * internal _router.stack contains Layer objects for every route and middleware.
 * This utility walks that stack and extracts route entries.
 *
 * Usage:
 *   const app = await NestFactory.create(SubAppModule, new ExpressAdapter(server));
 *   await app.init();
 *   const routes = extractRoutesFromExpress(app, "health");
 *   // → [{ method: "GET", path: "/health/", subAppId: "health" }, ...]
 */

import type { INestApplication } from '@nestjs/common';
import type { HttpMethod, RouteEntry } from '../gateway/route.types';

/**
 * Extract all HTTP routes from a running NestJS Express application.
 *
 * Reads the Express router stack (app.router.stack in Express 5) and walks
 * through:
 *   - Route layers (layer.route) → each has a path + methods + stack of handlers
 *   - Non-route layers are skipped (middleware, error handlers)
 *
 * @param app - A NestJS application that wraps an Express server
 * @param subAppId - Identifier for the sub-app owning these routes
 * @returns Array of route entries
 */
export function extractRoutesFromExpress(
  app: INestApplication,
  subAppId: string,
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const stack = getExpressStack(app);

  if (!stack || !Array.isArray(stack)) {
    return routes;
  }

  for (const rawLayer of stack) {
    const layer = isExpressLayer(rawLayer) ? rawLayer : null;
    if (!layer || !layer.route || !layer.route.path || !layer.route.methods) continue;

    const path = layer.route.path;
    const methods = layer.route.methods;

    for (const [method, enabled] of Object.entries(methods)) {
      if (!enabled) continue;
      routes.push({
        method: method.toUpperCase() as HttpMethod,
        path,
        subAppId,
      });
    }
  }

  return routes;
}

interface ExpressLayer {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
  };
}

function isExpressLayer(value: unknown): value is ExpressLayer {
  return typeof value === "object" && value !== null;
}

interface NestAppWithHttpAdapter {
  getHttpAdapter?(): {
    getInstance?(): { router?: { stack?: unknown[] }; _router?: { stack?: unknown[] } };
    instance?: { router?: { stack?: unknown[] }; _router?: { stack?: unknown[] } };
  };
  httpAdapter?: {
    getInstance?(): { router?: { stack?: unknown[] }; _router?: { stack?: unknown[] } };
    instance?: { router?: { stack?: unknown[] }; _router?: { stack?: unknown[] } };
  };
}

/**
 * Get the Express router stack from a NestJS application.
 * Supports Express 5 (app.router) and Express 4 (app._router).
 */
function getExpressStack(app: INestApplication): unknown[] | null {
  try {
    const adapter = (app as NestAppWithHttpAdapter).getHttpAdapter?.() ?? (app as NestAppWithHttpAdapter).httpAdapter;
    if (!adapter) return null;

    const instance = adapter.getInstance?.() ?? adapter.instance;
    if (!instance) return null;

    // Express 5: app.router.stack
    // Express 4: app._router.stack
    const router = instance.router ?? instance._router;
    return router?.stack ?? null;
  } catch {
    return null;
  }
}

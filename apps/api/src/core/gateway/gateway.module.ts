/**
 * GatewayModule — The gateway catch-all that proxies requests to sub-apps.
 *
 * This module:
 *   1. Registers a catch-all Express handler (before NestJS 404)
 *   2. On each request, consults RouteRegistryService to find the target sub-app
 *   3. Uses native Node.js http.request to proxy to the sub-app
 *   4. If no match, returns 503 (Service Unavailable — Starting)
 *
 * The gateway is the ONLY HTTP surface exposed to the outside world. All
 * sub-apps run on internal ports and are only reachable through the gateway.
 */

import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import * as http from 'node:http';
import * as https from 'node:https';
import { RouteRegistryService } from './route-registry.service';

@Injectable()
export class GatewayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(GatewayService.name);
  private catchAllRegistered = false;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly registry: RouteRegistryService,
  ) {}

  onApplicationBootstrap(): void {
    this.registerCatchAll();
  }

  onApplicationShutdown(): void {
    this.catchAllRegistered = false;
  }

  /**
   * Register the catch-all handler on the Express server, positioned BEFORE
   * NestJS's 404 handler so we intercept all unmatched requests.
   */
  registerCatchAll(): void {
    if (this.catchAllRegistered) return;

    const httpAdapter = this.adapterHost.httpAdapter;
    // Use the public getInstance() API (instance property is protected)
    const instance = httpAdapter.getInstance?.();
    if (!instance) {
      this.logger.warn('Cannot register catch-all: no Express instance found via getInstance()');
      return;
    }

    // Express 5: instance.router  Express 4: instance._router
    const router = instance.router ?? instance._router;
    if (!router) {
      this.logger.warn('Cannot register catch-all: no Express router found');
      return;
    }

    // Insert a catch-all layer at the top of the stack (before NestJS handlers)
    this.addCatchAllLayer(router);

    this.catchAllRegistered = true;
    this.logger.log('Gateway catch-all registered');
  }

  /**
   * Add a catch-all middleware to the Express router.
   * This runs before NestJS's 404 handler because we insert it at the
   * beginning of the stack.
   */
  private addCatchAllLayer(router: any): void {
    const catchAllHandler = (req: http.IncomingMessage, res: http.ServerResponse, next: (err?: any) => void) => {
      this.handleCatchAll(req, res).catch(next);
    };

    // Use layer.route is undefined for middleware (inserted before routes)
    // We use router.use() to register a catch-all, then move it to front
    router.use?.(catchAllHandler);

    // Move the catch-all layer to the front of the stack
    if (router.stack && router.stack.length > 0) {
      // The last layer is our catch-all (from router.use())
      const layer = router.stack.pop();
      if (layer) {
        router.stack.unshift(layer);
      }
    }
  }

  /**
   * Handle an incoming request: match against the route registry, proxy to
   * the target sub-app, or return 503 if no sub-app handles this route.
   */
  private async handleCatchAll(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const method = req.method ?? 'GET';
    const path = req.url ?? '/';

    // Try to match against registered routes
    const match = this.registry.match(method, path);

    if (!match) {
      this.logger.warn(`No sub-app registered for ${method} ${path}`);
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        statusCode: 503,
        message: 'Service not yet available — no sub-app registered for this route',
        requestId: (req as Request & { requestId: string }).requestId,
        path,
        method,
      }));
      return;
    }

    // Proxy the request to the matching sub-app
    await this.proxyRequest(req, res, match.targetUrl);
  }

  /**
   * Proxy an HTTP request to the target sub-app using Node's native http module.
   * Streams the request body to the target and pipes the response back.
   */
  private async proxyRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
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
            // Forward the original host as x-forwarded-host
            'x-forwarded-host': req.headers.host ?? '',
            'x-forwarded-proto': 'http',
            // Remove connection header to let Node manage it
            connection: undefined,
          },
          // Timeout after 30s
          timeout: 30_000,
        };

        const proxyReq = http.request(proxyOptions, (proxyRes) => {
          // Forward the status code
          res.statusCode = proxyRes.statusCode ?? 500;

          // Forward the response headers
          const responseHeaders = { ...proxyRes.headers };
          delete responseHeaders['transfer-encoding']; // Let Node handle this

          for (const [key, value] of Object.entries(responseHeaders)) {
            if (value !== undefined) {
              if (Array.isArray(value)) {
                res.setHeader(key, value);
              } else {
                res.setHeader(key, value);
              }
            }
          }

          // Stream the response body to the client
          proxyRes.pipe(res, { end: true });
          proxyRes.on('end', () => resolve());
        });

        proxyReq.on('error', (err: NodeJS.ErrnoException) => {
          this.logger.error(`Proxy error to ${targetUrl}: ${err.message}`, err.stack);
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

        // Stream the request body to the target
        if (req.readable) {
          req.pipe(proxyReq, { end: true });
        } else {
          proxyReq.end();
        }
      } catch (err: any) {
        this.logger.error(`Proxy setup failed for ${targetUrl}: ${err.message}`, err.stack);
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
}

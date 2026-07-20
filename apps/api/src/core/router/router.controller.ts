/**
 * RouterController — NestJS catch-all controller that proxies requests to
 * registered sub-apps via the RouteRegistryService.
 *
 * Since sub-apps run on independent HTTP ports, this controller acts as an
 * API gateway: it receives all incoming requests, matches the path against
 * the route graph, and proxies to the correct sub-app using Node's native
 * http module.
 *
 * If no sub-app matches, it returns 503 (Service Not Ready). The default
 * fallback is the "main-app" which handles 404s internally.
 */

import {
  All,
  Controller,
  Req,
  Res,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as http from 'node:http';
import { RouteRegistryService } from '../gateway/route-registry.service';

@Controller()
export class RouterController implements OnApplicationShutdown {
  private readonly pending = new Set<http.ClientRequest>();

  constructor(private readonly registry: RouteRegistryService) {}

  /**
   * Catch-all route handler. Every request that reaches NestJS hits this
   * method. If the gateway's Express-level catch-all already handled it
   * (via createGatewayCatchAll), this is never reached — but this serves
   * as a safety net.
   */
  @All('*')
  async handleRequest(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const method = req.method;
    const path = req.originalUrl ?? req.url ?? '/';

    // Try to match against registered sub-app routes
    const match = this.registry.match(method, path);

    if (!match) {
      // No sub-app handles this route
      res.status(503).json({
        statusCode: 503,
        message: 'Service not yet available — no sub-app registered for this route',
        path,
        method,
      });
      return;
    }

    // Proxy to the matched sub-app
    await this.proxyRequest(req, res, match.targetUrl);
  }

  /**
   * Proxy an Express request to the target sub-app URL using Node's native
   * http module. Streams the response body back to the original client.
   */
  private proxyRequest(
    req: Request,
    res: Response,
    targetUrl: string,
  ): Promise<void> {
    return new Promise((resolve) => {
      let url: URL;
      try {
        url = new URL(targetUrl);
      } catch {
        res.status(502).json({ statusCode: 502, message: `Invalid target URL: ${targetUrl}` });
        resolve();
        return;
      }

      // Remove connection header — let Node.js manage it.
      // Setting `connection: undefined` causes Node's strict header validation
      // to coerce `undefined` to the string `"undefined"`, which is invalid.
      const { connection: _conn, ...safeHeaders } = req.headers;

      const proxyOptions: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: req.method,
        headers: {
          ...safeHeaders,
          'x-forwarded-host': req.headers.host ?? '',
          'x-forwarded-proto': 'http',
        },
        timeout: 30_000,
      };

      const proxyReq = http.request(proxyOptions, (proxyRes) => {
        res.statusCode = proxyRes.statusCode ?? 500;

        // Forward response headers
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (value !== undefined) {
            res.setHeader(key, Array.isArray(value) ? value.join(', ') : value);
          }
        }

        // Stream response body
        proxyRes.pipe(res, { end: true });
        proxyRes.on('end', () => resolve());
      });

      proxyReq.on('error', (err: NodeJS.ErrnoException) => {
        if (!res.headersSent) {
          res.status(502).json({
            statusCode: 502,
            message: `Bad Gateway: ${err.message}`,
          });
        }
        resolve();
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        if (!res.headersSent) {
          res.status(504).json({
            statusCode: 504,
            message: 'Gateway Timeout — sub-app did not respond in time',
          });
        }
        resolve();
      });

      // Track for cleanup
      this.pending.add(proxyReq);
      proxyReq.on('close', () => this.pending.delete(proxyReq));

      // Stream request body to target
      if (req.readable) {
        req.pipe(proxyReq, { end: true });
      } else {
        proxyReq.end();
      }
    });
  }

  /** Clean up pending requests on shutdown */
  onApplicationShutdown(): void {
    for (const req of this.pending) {
      req.destroy();
    }
    this.pending.clear();
  }
}

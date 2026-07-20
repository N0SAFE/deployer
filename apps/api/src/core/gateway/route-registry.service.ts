/**
 * RouteRegistryService — Stores the dynamic routing graph of all registered
 * sub-apps and matches incoming requests to the correct target port.
 *
 * The graph is built incrementally as each sub-app starts:
 *   register(subAppRegistration) → adds all routes from the sub-app
 *   match(method, path) → returns the target port + sub-app id
 *
 * Matching strategy: longest-prefix-match. For a given path, the route with
 * the longest matching prefix wins. This handles nested prefixes correctly
 * (e.g., /api/auth/sign-in matches /api/auth before /api).
 */

import { logger } from '@repo/logger';
import type { HttpMethod, RoutePattern, SubAppRegistration } from './route.types';

export class RouteRegistryService {
  private log = logger.scope('RouteRegistry');

  /** All registered route patterns, indexed by method then sorted by specificity */
  private routesByMethod = new Map<HttpMethod, RoutePattern[]>();
  private _isReady = false;

  /**
   * Fallback target for routes not registered in the graph.
   * When set, unmatched requests are proxied to this target instead
   * of returning 503. This is typically the main-app (AppModule) which
   * may have middleware-registered routes (e.g. BetterAuth) not visible
   * to the Express route extractor.
   */
  private fallbackTarget: { targetUrl: string; subAppId: string } | null = null;

  get isReady(): boolean {
    return this._isReady;
  }

  /** Set the fallback target for unmatched requests */
  setFallback(target: { targetUrl: string; subAppId: string }): void {
    this.fallbackTarget = target;
    this.log.info(`Fallback target set to "${target.subAppId}" at ${target.targetUrl}`);
  }

  /**
   * Register all routes from a sub-app.
   * Called by the sub-app runner after a sub-app starts.
   */
  register(registration: SubAppRegistration): void {
    this.log.info(
      `Registering sub-app "${registration.id}" (port ${String(registration.port)}) with ${String(registration.routes.length)} routes`,
    );

    for (const route of registration.routes) {
      const pattern: RoutePattern = {
        method: route.method,
        pathPattern: route.path,
        subAppId: route.subAppId,
        targetPort: registration.port,
      };

      const existing = this.routesByMethod.get(route.method) ?? [];
      existing.push(pattern);
      this.routesByMethod.set(route.method, existing);
    }

    // Sort each method's routes by specificity (longest path first)
    for (const [method, patterns] of this.routesByMethod) {
      patterns.sort((a, b) => b.pathPattern.length - a.pathPattern.length);
      this.routesByMethod.set(method, patterns);
    }

    const total = this.totalRoutes;
    this.log.info(`Route graph now has ${String(total)} routes across ${String(this.routesByMethod.size)} methods`);
  }

  /**
   * Remove all routes for a sub-app (e.g., on shutdown).
   */
  unregister(subAppId: string): void {
    let removed = 0;
    for (const [method, patterns] of this.routesByMethod) {
      const filtered = patterns.filter((p) => p.subAppId !== subAppId);
      if (filtered.length !== patterns.length) {
        removed += patterns.length - filtered.length;
        this.routesByMethod.set(method, filtered);
      }
    }
    if (removed > 0) {
      this.log.info(`Unregistered ${String(removed)} routes for sub-app "${subAppId}"`);
    }
  }

  /**
   * Match an incoming request to the best sub-app target.
   *
   * Strategy: longest-prefix-match on the path, filtered by method.
   * For path patterns with params (e.g., /user/:id), we use simple
   * segment matching first, then fall back to pattern matching.
   *
   * @returns The target URL (e.g., "http://localhost:3011/api/auth/sign-in/email")
   *          or null if no match
   */
  match(method: string, path: string): { targetUrl: string; subAppId: string } | null {
    const normalizedMethod = method.toUpperCase() as HttpMethod;
    const patterns = this.routesByMethod.get(normalizedMethod);
    if (patterns && patterns.length > 0) {
      for (const pattern of patterns) {
        if (this.pathMatches(path, pattern.pathPattern)) {
          const port = pattern.targetPort;
          return {
            targetUrl: `http://127.0.0.1:${String(port)}${path}`,
            subAppId: pattern.subAppId,
          };
        }
      }
    }

    // No registered route matched — use fallback if set.
    // Append the original request path so the sub-app receives the full path
    // (e.g., /api/auth/sign-in/email, not just /).
    if (this.fallbackTarget) {
      const base = this.fallbackTarget.targetUrl;
      const joined = base.endsWith('/') ? `${base.slice(0, -1)}${path}` : `${base}${path}`;
      return { targetUrl: joined, subAppId: this.fallbackTarget.subAppId };
    }

    return null;
  }

  /**
   * Check if a request path matches a route pattern.
   * Supports Express-style params (:id) and simple prefixes.
   */
  private pathMatches(requestPath: string, pattern: string): boolean {
    // Normalize both to remove trailing slashes for comparison
    const normPath = requestPath.replace(/\/+$/, '') || '/';
    const normPattern = pattern.replace(/\/+$/, '') || '/';

    // Exact match
    if (normPath === normPattern) return true;

    // Pattern has params: split into segments, compare segment-by-segment
    const pathSegments = normPath.split('/').filter(Boolean);
    const patternSegments = normPattern.split('/').filter(Boolean);

    if (pathSegments.length < patternSegments.length) return false;

    for (let i = 0; i < patternSegments.length; i++) {
      const patSeg = patternSegments[i];
      if (patSeg === undefined) continue;
      const reqSeg = pathSegments[i];

      // Param segment matches anything
      if (patSeg.startsWith(':') || patSeg.startsWith('{')) continue;

      // Wildcard matches everything remaining
      if (patSeg === '*' || patSeg === '**') return true;

      // Exact segment match
      if (reqSeg === undefined || patSeg !== reqSeg) return false;
    }

    // All pattern segments matched
    return true;
  }

  /** Get a summary of all registered routes */
  getRouteSummary(): Record<string, { port: number; routes: RoutePattern[] }> {
    const summary: Record<string, { port: number; routes: RoutePattern[] }> = {};

    for (const [, patterns] of this.routesByMethod) {
      for (const pattern of patterns) {
        const existing = summary[pattern.subAppId];
        if (!existing) {
          summary[pattern.subAppId] = { port: pattern.targetPort, routes: [pattern] };
        } else {
          existing.routes.push(pattern);
        }
      }
    }

    return summary;
  }

  private get totalRoutes(): number {
    let count = 0;
    for (const [, patterns] of this.routesByMethod) {
      count += patterns.length;
    }
    return count;
  }
}

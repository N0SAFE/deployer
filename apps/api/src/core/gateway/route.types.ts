/**
 * Route types shared between the gateway and sub-apps.
 *
 * A "route entry" represents a single HTTP route (method + path) exposed
 * by a sub-app. The gateway uses these to build its routing graph and
 * proxy requests to the correct sub-app port.
 */

/** Standard HTTP methods */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** A single route registered by a sub-app */
export interface RouteEntry {
  method: HttpMethod;
  /** Full path including prefix, e.g., "/health/" or "/api/auth/sign-in/email" */
  path: string;
  /** Identifier for the sub-app that owns this route */
  subAppId: string;
}

/** Payload a sub-app sends to the gateway when registering */
export interface SubAppRegistration {
  /** Unique sub-app identifier, e.g., "health", "auth" */
  id: string;
  /** The HTTP port this sub-app is listening on */
  port: number;
  /** All routes this sub-app exposes */
  routes: RouteEntry[];
}

/**
 * A normalized route pattern used by the gateway for matching.
 * Path params like :id are preserved as-is from Express.
 */
export interface RoutePattern {
  method: HttpMethod;
  /** Pattern with Express-style params, e.g., "/user/:id" */
  pathPattern: string;
  subAppId: string;
  targetPort: number;
}

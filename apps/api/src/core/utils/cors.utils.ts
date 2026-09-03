/**
 * CORS utility functions for handling origin validation and normalization
 */

/**
 * Normalize URL by removing trailing slash
 * @param url - The URL to normalize
 * @returns The normalized URL without trailing slash
 */
export const normalizeUrl = (url: string): string => url.replace(/\/$/, '');

/**
 * Build list of allowed origins from environment variables
 * @param env - Environment variables object
 * @returns Array of normalized allowed origins
 */
export const buildAllowedOrigins = (env: {
  NEXT_PUBLIC_APP_URL?: string;
  APP_URL?: string;
  TRUSTED_ORIGINS?: string;
}): string[] => {
  const allowedOrigins: string[] = [];

  // Add configured app URL (public facing URL)
  if (env.NEXT_PUBLIC_APP_URL) {
    allowedOrigins.push(normalizeUrl(env.NEXT_PUBLIC_APP_URL));
  }

  // Add internal app URL (Docker network URL) if different
  if (env.APP_URL && env.APP_URL !== env.NEXT_PUBLIC_APP_URL) {
    allowedOrigins.push(normalizeUrl(env.APP_URL));
  }

  // Add additional trusted origins
  if (env.TRUSTED_ORIGINS) {
    env.TRUSTED_ORIGINS.split(',').forEach(origin => {
      const trimmed = origin.trim();
      if (trimmed) {
        allowedOrigins.push(normalizeUrl(trimmed));
      }
    });
  }

  // Fallback to localhost:3000 if no origins configured
  if (allowedOrigins.length === 0) {
    allowedOrigins.push('http://localhost:3000');
  }

  return allowedOrigins;
};

/**
 * Check if origin matches localhost patterns
 * Used in development mode to be more permissive
 * @param origin - The origin to check
 * @returns True if origin is a localhost variant
 */
export const isLocalhostOrigin = (origin: string): boolean => {
  const localhostPattern = /^https?:\/\/localhost(:\d+)?$/;
  const ipPattern = /^https?:\/\/127\.0\.0\.1(:\d+)?$/;
  return localhostPattern.test(origin) || ipPattern.test(origin);
};

// ─── API-centric CORS policy ────────────────────────────────────────────────
// Cross-origin trust moved from static origin lists to possession of an
// app-instance token (X-App-Instance-Token header). Because that path is
// credential-free (no cookies), reflecting any origin WITHOUT the credentials
// flag is safe: attacker pages cannot read privileged responses they cannot
// authenticate against, and browsers refuse credentials on non-allowlisted
// reflections anyway.

/** The app-instance identity header — statically allowed on every preflight. */
const APP_INSTANCE_TOKEN_HEADER = 'x-app-instance-token';

/** Headers allowed on cross-origin API requests. */
export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Cookie',
  APP_INSTANCE_TOKEN_HEADER,
];

export interface CorsDecision {
  /** Reflect the requesting origin in Access-Control-Allow-Origin. */
  allowOrigin: boolean;
  /** Emit Access-Control-Allow-Credentials (cookie-capable flows). */
  allowCredentials: boolean;
}

/**
 * Decide the CORS response for a request origin under the api-centric model.
 *
 * Priority order:
 *   1. No Origin header        → same-origin/no-cors; no CORS headers needed.
 *   2. Allowlisted origin      → full reflection WITH credentials.
 *   3. Dev + localhost variant → full reflection WITH credentials.
 *   4. Cross-origin WITH cookies from an untrusted origin → BLOCKED.
 *   5. Cross-origin cookie-free (token path) → reflection WITHOUT credentials.
 *
 * Rule 4 is the security boundary: stolen/ambient cookies can never be used
 * cross-origin to read responses, because untrusted origins carrying cookies
 * get no CORS headers at all. Rule 5 is what makes BYO web apps on unknown
 * origins work without any server-side configuration.
 */
export const resolveCorsDecision = (input: {
  origin: string | undefined;
  hasCookieHeader: boolean;
  allowedOrigins: string[];
  isDevelopment: boolean;
}): CorsDecision => {
  const { origin, hasCookieHeader, allowedOrigins, isDevelopment } = input;

  // 1. Same-origin / curl / server-to-server — CORS is irrelevant.
  if (!origin) {
    return { allowOrigin: false, allowCredentials: false };
  }

  const normalized = normalizeUrl(origin);
  const isAllowlisted =
    allowedOrigins.includes(normalized) ||
    (isDevelopment && isLocalhostOrigin(normalized));

  // 2./3. Trusted surfaces keep their credentialed cookie flows.
  if (isAllowlisted) {
    return { allowOrigin: true, allowCredentials: true };
  }

  // 4. Untrusted origin trying to ride ambient credentials — hard block.
  if (hasCookieHeader) {
    return { allowOrigin: false, allowCredentials: false };
  }

  // 5. Credential-free token path (BYO web apps, any origin).
  return { allowOrigin: true, allowCredentials: false };
};

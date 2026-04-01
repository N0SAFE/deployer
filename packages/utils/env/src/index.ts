import zod from "zod/v4";
import { guardedUrl, parseDebugScopes, trimTrailingSlash } from "./utils";
import { LOCAL_APP_FALLBACK, LOCAL_API_FALLBACK, DEFAULT_API_PORT } from "./constants";

// ============================================================================
// Shared Environment Variables
// ============================================================================

/**
 * Shared environment variables used across multiple apps
 */
const sharedEnvVars = {
    NEXT_PUBLIC_APP_URL: guardedUrl("NEXT_PUBLIC_APP_URL", LOCAL_APP_FALLBACK),
    NODE_ENV: zod.enum(["development", "production", "test"]).default("development"),
};

interface BooleanEnvTokenBuckets {
    strings?: readonly string[];
    numbers?: readonly number[];
    booleans?: readonly boolean[];
}

interface BooleanEnvOptions {
    true?: BooleanEnvTokenBuckets;
    false?: BooleanEnvTokenBuckets;
}

type BooleanEnvPrimitiveToken = string | number | boolean;

const DEFAULT_BOOLEAN_ENV_OPTIONS: Required<BooleanEnvOptions> = {
    true: {
        strings: ["1", "true", "yes", "on"],
        numbers: [1],
        booleans: [true],
    },
    false: {
        strings: ["0", "false", "no", "off"],
        numbers: [0],
        booleans: [false],
    },
};

const flattenBooleanTokens = (buckets?: BooleanEnvTokenBuckets): BooleanEnvPrimitiveToken[] => {
    if (!buckets) {
        return [];
    }

    return [
        ...(buckets.strings ?? []),
        ...(buckets.numbers ?? []),
        ...(buckets.booleans ?? []),
    ];
};

const normalizeBooleanToken = (token: BooleanEnvPrimitiveToken): string => {
    if (typeof token === "string") {
        return token.trim().toLowerCase();
    }

    return String(token).trim().toLowerCase();
};

const normalizeBooleanTokenList = (tokens: readonly BooleanEnvPrimitiveToken[]): Set<string> => {
    const normalized = new Set<string>();
    for (const token of tokens) {
        normalized.add(normalizeBooleanToken(token));
    }
    return normalized;
};

const booleanEnv = (options: BooleanEnvOptions = {}) => {
    const trueTokens = normalizeBooleanTokenList([
        ...flattenBooleanTokens(DEFAULT_BOOLEAN_ENV_OPTIONS.true),
        ...flattenBooleanTokens(options.true),
    ]);
    const falseTokens = normalizeBooleanTokenList([
        ...flattenBooleanTokens(DEFAULT_BOOLEAN_ENV_OPTIONS.false),
        ...flattenBooleanTokens(options.false),
    ]);

    return zod.preprocess((value) => {
        if (value === undefined || value === null) {
            return value;
        }

        if (
            typeof value !== "string" &&
            typeof value !== "number" &&
            typeof value !== "boolean"
        ) {
            return value;
        }

        const normalizedValue = normalizeBooleanToken(value);

        if (trueTokens.has(normalizedValue)) {
            return true;
        }

        if (falseTokens.has(normalizedValue)) {
            return false;
        }

        return value;
    }, zod.boolean());
};

// ============================================================================
// Environment Variable Schemas by App
// ============================================================================

/**
 * API App (NestJS) Environment Variables
 * Used by apps/api
 */
export const apiEnvSchema = zod
    .object({
        // Database — optional: if omitted, the node config file (SQLite) is the source of truth.
        // The API will start in "setup mode" until a DATABASE_URL is available from either source.
        DATABASE_URL: zod.string().min(1).optional(),

        // API
        API_PORT: zod.coerce.number().int().min(1).max(65535).default(DEFAULT_API_PORT),
        NEXT_PUBLIC_API_URL: guardedUrl("NEXT_PUBLIC_API_URL", LOCAL_API_FALLBACK),
        DOCKER_HOST: zod.string().optional(),
        DOCKER_PORT: zod.coerce.number().int().min(1).max(65535).optional(),

        // Web App URLs (for trusted origins)
        APP_URL: zod.url().optional(), // Private Docker network URL
        LOAD_BALANCER_URL: zod.url().optional(),

        // Authentication
        AUTH_SECRET: zod.string().min(1, "AUTH_SECRET is required"),
        BETTER_AUTH_SECRET: zod.string().min(1, "BETTER_AUTH_SECRET is required"),
        AUTH_BASE_DOMAIN: zod.string().optional(),
        DEV_AUTH_KEY: zod.string().optional(),
        DEFAULT_ADMIN_EMAIL: zod.email().optional(), // Email of the default admin user (also used for master token impersonation)
        DEFAULT_ADMIN_PASSWORD: zod.string().optional(), // Password for the default admin user (used for credential-based auth fallback)
        TRUSTED_ORIGINS: zod.string().optional(),
        // Optional: when undefined, auth factory auto-enables master token if
        // DEV_AUTH_KEY and DEFAULT_ADMIN_EMAIL are both configured.
        // Set explicitly to true/false to force behavior.
        ENABLE_MASTER_TOKEN: zod.coerce.boolean().optional(),

        BACKUP_PATH: zod.string().optional().default("/tmp/backups"),
        STORAGE_PATH: zod.string().optional().default("/tmp/storage"),

        TRAEFIK_CONFIG_BASE_PATH: zod.string().optional().default("/app/traefik-configs"),
        TRAEFIK_BACKUP_PATH: zod.string().optional().default("/app/traefik-configs/backups"),
        TRAEFIK_STARTUP_SYNC_ENABLED: zod.boolean().optional().default(true),
        TRAEFIK_FAIL_ON_STARTUP_ERROR: zod.boolean().optional().default(false),
        TRAEFIK_CLEANUP_ON_STARTUP: zod.boolean().optional().default(false),

        // Mesh / distributed runtime
        MESH_NODE_ID: zod.string().optional(),
        MESH_CLUSTER_ID: zod.string().optional(),
        MESH_NODE_SERVER_URL: zod.url().optional(),
        MESH_BOOTSTRAP_PEERS: zod.string().optional(),
        MESH_STREAM_SHARED_SECRET: zod.string().optional(),
        MESH_SYNC_INTERVAL_MS: zod.coerce.number().int().optional(),
        MESH_PING_SAMPLES: zod.coerce.number().int().optional(),
        MESH_PING_TIMEOUT_MS: zod.coerce.number().int().optional(),
        MESH_PEER_MIN: zod.coerce.number().int().optional(),
        MESH_PEER_MAX: zod.coerce.number().int().optional(),
        MESH_PEER_IMPROVEMENT_THRESHOLD: zod.coerce.number().optional(),
        MESH_PEER_MAX_REPLACEMENTS: zod.coerce.number().int().optional(),
        MESH_PEER_LATENCY_BUDGET_MS: zod.coerce.number().int().optional(),
        MESH_CONTROL_ENVELOPE_SIGNING_KEY: zod.string().optional(),
        MESH_CONTROL_ENVELOPE_SIGNING_KID: zod.string().optional(),
        MESH_CONTROL_ENVELOPE_TRUST_REQUIRED: booleanEnv().optional().default(false),
        MESH_TRUST_STRICT_MIN_ACK_RATIO: zod.coerce.number().optional(),
        MESH_TRUST_STRICT_MAX_ACK_AGE_SECONDS: zod.coerce.number().int().optional(),
        MESH_TRUST_STRICT_ROLLOUT_WAVE_SIZE: zod.coerce.number().int().optional(),
        MESH_TRUST_STRICT_AUTO_ROLLBACK: booleanEnv().optional().default(false),
        MESH_REPLAY_WINDOW_MS: zod.coerce.number().int().optional(),
        MESH_STRICT_REPLAY_GUARD: booleanEnv().optional().default(false),

        // Shared
        ...sharedEnvVars,
    })
    .refine(
        (data) => {
            if (data.BETTER_AUTH_SECRET && data.BETTER_AUTH_SECRET !== data.AUTH_SECRET) {
                return false;
            }
            return true;
        },
        {
            message: "BETTER_AUTH_SECRET must match AUTH_SECRET when provided",
            path: ["BETTER_AUTH_SECRET"],
        },
    );

/**
 * Web App (Next.js) Environment Variables
 * Used by apps/web
 */
export const webEnvSchema = zod
    .object({
        // React Scan Configuration
        REACT_SCAN_GIT_COMMIT_HASH: zod.string().optional(),
        REACT_SCAN_GIT_BRANCH: zod.string().optional(),
        REACT_SCAN_TOKEN: zod.string().optional(),

        API_URL: guardedUrl("API_URL", LOCAL_API_FALLBACK),

        // Public API Configuration
        NEXT_PUBLIC_API_URL: guardedUrl("NEXT_PUBLIC_API_URL", LOCAL_API_FALLBACK),
        NEXT_PUBLIC_API_PORT: zod.coerce.number().int().min(1).max(65535).optional(),
        NEXT_PUBLIC_APP_PORT: zod.coerce.number().int().min(1).max(65535).optional(),

        // Authentication
        AUTH_SECRET: zod.string().min(1, "AUTH_SECRET is required"),
        BETTER_AUTH_SECRET: zod.string().min(1, "BETTER_AUTH_SECRET is required"),
        AUTH_BASE_DOMAIN: zod.string().optional(),
        DEV_AUTH_KEY: zod.string().optional(),
        NEXT_PUBLIC_SHOW_AUTH_LOGS: zod.coerce.boolean().optional().default(false),

        // Debug configuration - supports advanced patterns:
        // - "middleware/auth" (exact match)
        // - "middleware/*" (direct children only)
        // - "middleware/**" (all nested children)
        // - "middleware/{auth,router,cors}/*" (multiple sub-scopes)
        // - "*" (everything)
        // - "middleware/*,auth/test,api/{users,posts}/**" (multiple patterns)
        NEXT_PUBLIC_DEBUG: zod.string().optional().default("").transform(parseDebugScopes),

        // Optional docs site config; when set, used to render a Docs link in the navbar
        NEXT_PUBLIC_DOC_URL: zod
            .string()
            .url()
            .optional()
            .transform((url) => (url ? trimTrailingSlash(url) : url)),
        NEXT_PUBLIC_DOC_PORT: zod.coerce.number().optional(),

        // Development Tools
        REACT_SCAN: zod.coerce.boolean().optional().default(false),
        MILLION_LINT: zod.coerce.boolean().optional().default(false),

        ...sharedEnvVars,
    })
    .refine(
        (data) => {
            if (data.BETTER_AUTH_SECRET && data.BETTER_AUTH_SECRET !== data.AUTH_SECRET) {
                return false;
            }
            return true;
        },
        {
            message: "BETTER_AUTH_SECRET must match AUTH_SECRET when provided",
            path: ["BETTER_AUTH_SECRET"],
        },
    );

/**
 * Doc App (Fumadocs) Environment Variables
 * Used by apps/doc
 */
export const docEnvSchema = zod.object({
    // Shared
    NODE_ENV: sharedEnvVars.NODE_ENV,
});

/**
 * Load Balancer App (NestJS) Environment Variables
 * Used by apps/load-balancer
 */
export const loadBalancerEnvSchema = zod.object({
    NODE_ENV: sharedEnvVars.NODE_ENV,

    // Runtime
    LOAD_BALANCER_PORT: zod.coerce.number().int().min(1).max(65535).default(3010),
    API_URL: guardedUrl("API_URL", LOCAL_API_FALLBACK),
    APP_URL: zod.url().optional(),

    // Routing/affinity
    // Canonical key for forward token signing (LB_ROUTE_SECRET kept as backward-compatible alias)
    LB_FORWARD_TOKEN_SECRET: zod.string().optional(),
    LB_ROUTE_SECRET: zod.string().min(1).default("dev-lb-route-secret"),
    LB_FORWARD_TOKEN_SECRET_PREVIOUS: zod.string().optional().default(""),
    LB_ROUTE_SECRET_PREVIOUS: zod.string().optional().default(""),
    LB_DIAGNOSTIC_SECRET: zod.string().min(1).default("dev-lb-diag-secret"),
    LB_DIAGNOSTIC_PATH_FINGERPRINT: zod.string().min(1).default("__lb_diag"),
    LB_LOCAL_UPSTREAM_URL: zod.url().optional(),
    LB_ROUTE_KEYRING_REFRESH_MS: zod.coerce.number().int().min(1).default(30_000),
    LB_REPORT_TTL_MS: zod.coerce.number().int().min(1).default(30_000),
    LB_LOAD_REPORT_DEDUPE_TTL_MS: zod.coerce.number().int().min(1).default(120_000),
    LB_LOAD_REPORT_MAX_HOPS: zod.coerce.number().int().min(0).default(2),
    LB_PEER_URLS: zod.string().default(""),

    // Mesh
    MESH_NODE_ID: zod.string().optional(),
    MESH_STREAM_SHARED_SECRET: zod.string().optional(),
});

// ============================================================================
// Combined Schema for All Apps
// ============================================================================

/**
 * Combined schema that validates all apps' environment variables
 */
export const allEnvSchema = zod.object({
    api: apiEnvSchema,
    web: webEnvSchema,
    doc: docEnvSchema,
});

// ============================================================================
// Type Exports
// ============================================================================

export type ApiEnv = zod.infer<typeof apiEnvSchema>;
export type WebEnv = zod.infer<typeof webEnvSchema>;
export type DocEnv = zod.infer<typeof docEnvSchema>;
export type LoadBalancerEnv = zod.infer<typeof loadBalancerEnvSchema>;
export type AllEnv = zod.infer<typeof allEnvSchema>;

// ============================================================================
// Re-export Everything
// ============================================================================

export { trimTrailingSlash, guardedUrl, parseDebugScopes } from "./utils";
export * from "./constants";
export * from "./validate";

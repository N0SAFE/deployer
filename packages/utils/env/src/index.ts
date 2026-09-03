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

/**
 * Optional string that also tolerates an EMPTY string (compose passes
 * `${VAR:-}` which yields ""). Empty/absent → undefined (the supervisor
 * falls back to its default resolution).
 */
const emptyableString = (minLength = 1) =>
	zod.preprocess(
		(value) => (value === undefined || value === "" ? undefined : String(value).trim()),
		zod.string().min(minLength).optional(),
	);

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

export const apiEnvSchema = zod
    .object({
        // Database — NOT read from env at runtime. The database URL is resolved
        // by the Phase 0 setup sub-app which reads SETUP_AUTO_DATABASE_URL (or
        // legacy SETUP_DATABASE_URL) if set, otherwise auto-provisions Postgres
        // via Docker. The resolved URL is persisted to the local SQLite
        // node_config table and read from there at runtime.
        // See SetupDevService for details.
        //
        // Structured DB env vars — used by Phase 0 setup when SETUP_AUTO=true.
        // In production these are not needed (URL resolved via setup sub-app).
        //
        // SETUP_AUTO_DATABASE_URL is the preferred explicit database for
        // SETUP_AUTO=true (probed — unreachable URL fails boot hard).
        // SETUP_DATABASE_URL is kept as a backwards-compatible alias.
        SETUP_AUTO_DATABASE_URL: zod.string().optional(),
        SETUP_DATABASE_URL: zod.string().optional(),
        SETUP_AUTO: booleanEnv().default(false),
        DB_HOST: zod.string().optional(),
        DB_PORT: zod.string().optional(),
        DB_USER: zod.string().optional(),
        DB_PASSWORD: zod.string().optional(),
        DB_DATABASE: zod.string().optional(),

        // API
        API_PORT: zod.coerce.number().int().min(1).max(65535).default(DEFAULT_API_PORT),
        NEXT_PUBLIC_API_URL: guardedUrl("NEXT_PUBLIC_API_URL", LOCAL_API_FALLBACK),
        DOCKER_HOST: zod.string().optional(),
        DOCKER_PORT: zod.coerce.number().int().min(1).max(65535).optional(),

        // Web App URLs (for trusted origins)
        APP_URL: zod.url().optional(), // Private Docker network URL

        // Managed-web tunnel: which Cloudflare provider app owns the web's
        // dedicated tunnel (default: first tunnel-capable app).
        CLOUDFLARE_WEB_TUNNEL_PROVIDER_ID: zod.string().optional(),

        // Authentication — resolved through mesh secret sharing at runtime.
        // Optional in env so the container can start without them.
        AUTH_SECRET: zod.string().optional(),
        BETTER_AUTH_SECRET: zod.string().optional(),
        AUTH_BASE_DOMAIN: zod.string().optional(),
        DEV_AUTH_KEY: zod.string().optional(),
        DEFAULT_ADMIN_EMAIL: zod.email().optional(),
        DEFAULT_ADMIN_PASSWORD: zod.string().optional(),
        DEFAULT_ADMIN_NAME: zod.string().optional().default("Admin"),
        DEFAULT_ADMIN_ORGANIZATION: zod.string().optional().default("My Organization"),
        GITHUB_WEBHOOK_SECRET: zod.string().optional(),
        DEPLOYMENT_UPLOAD_DIR: zod.string().optional().default("/tmp/deployer-uploads"),
        APP_DOCKER_IMAGE_SCAN_PARALLELISM: zod.coerce.number().int().min(1).optional().default(5),
        APP_DOCKER_IMAGE_SCAN_IMAGE_PARALLELISM: zod.coerce.number().int().min(1).optional().default(3),
        TRUSTED_ORIGINS: zod.string().optional(),
        ENABLE_MASTER_TOKEN: zod.coerce.boolean().optional(),

        // ─── API-centric platform deployment (api-centric-deployment-architecture) ───
        // DEPLOYER_PREFIX drives the Traefik hostname grammar:
        //   "" (empty) → api.deployer.localhost / web.deployer.localhost
        //   "acme"     → api.acme.deployer.localhost / app.acme.deployer.localhost
        // Empty string is the zero-value for "no prefix segment" — no sentinel needed.
        DEPLOYER_PREFIX: zod
            .string()
            .trim()
            .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "prefix must be lowercase alphanumerics/dashes and not start or end with a dash")
            .or(zod.literal(""))
            .default(""),
        // Dev side-by-side marker: a web app is already running outside the
        // API's supervision (dev:local, dev:web). The API must NOT spawn its
        // own managed web container and must NOT serve the /manage/web-app page.
        MANAGED_WEB_APP_EXTERNAL: booleanEnv().default(false),
        // Seed value for the managed_web_app.enabled platform flag. The DB wins
        // after first boot; this only seeds the initial state.
        MANAGED_WEB_APP_ENABLED: booleanEnv().default(true),
        // Image override for the API-spawned managed web container.
        // Default: same release tag as the API image (compatibility guarantee).
        MANAGED_WEB_APP_IMAGE: zod.string().min(1).optional(),
        // Web container name on the PLATFORM network that serves
        // web.<prefix>deployer.localhost (explicit). Compose side-by-side
        // stacks pass their web container/alias (e.g. `web-dev`); prod can
        // leave it empty → the managed web container is used when enabled.
        DEPLOYER_WEB_TARGET: emptyableString().optional(),
        // API container name/alias on the PLATFORM network that Traefik
        // routes api.<prefix>deployer.localhost to. Compose passes its own
        // container name (e.g. `api-dev`); when unset the supervisor resolves
        // it from the container id (docker embedded DNS) or falls back to the
        // host gateway.
        DEPLOYER_API_TARGET: emptyableString().optional(),
        // Image for the API-supervised platform Traefik ingress container.
        DEPLOYER_TRAEFIK_IMAGE: zod.string().min(1).default("traefik:v3.3"),
        // Host port the platform Traefik publishes its HTTP entrypoint on
        // (dev). Default 80 — override when host port 80 is occupied by
        // another service (e.g. a host proxy). The persisted platform
        // setting `ingress.entry_port` (local DB) OVERRIDES this env when set.
        // When even this port is taken, Traefik falls back to running
        // headless on the platform network only (internal routing works) and
        // the app surfaces a BIG WARNING instead of crashing.
        DEPLOYER_TRAEFIK_HTTP_PORT: zod.coerce.number().int().min(1).max(65535).default(80),
        // W5 TLS scaffolding: when true, the Traefik supervisor adds the
        // websecure (443) entrypoint + HTTP→HTTPS redirect, serving Traefik's
        // built-in SELF-SIGNED default certificate until a real certificate
        // source is configured. Default false keeps plain-HTTP dev flows.
        DEPLOYER_TRAEFIK_TLS_ENABLED: booleanEnv().optional().default(false),
        // ACME contact e-mail used by the letsencrypt certificate resolver in
        // the generated (non-DB) main config when TLS is enabled. Persisted
        // platform TLS settings (local DB) override this per-domain.
        DEPLOYER_TRAEFIK_ACME_EMAIL: zod.string().optional().default("admin@example.com"),

        // ─── Platform Redis (API-supervised, D-5) ─────────────────────────
        // Redis is supervised BY THE API (RedisSupervisorService) like
        // traefik/local-db — NOT a compose service. It runs headless on the
        // platform network as `deployer-redis:6379`; the typed connection URL
        // is computed by RedisSupervisorService.getConnectionUrl(). Override
        // with DEPLOYER_REDIS_URL when pointing at an external/existing Redis.
        DEPLOYER_REDIS_URL: zod.string().optional().default("redis://deployer-redis:6379"),
        DEPLOYER_REDIS_IMAGE: zod.string().min(1).default("redis:7-alpine"),
        // Optional host bind for debugging (the container is headless by
        // default — in-network consumers never need a host port).
        DEPLOYER_REDIS_PORT: zod.coerce.number().int().min(1).max(65535).optional(),
        // Optional auth — sets `--requirepass` on the supervised container.
        DEPLOYER_REDIS_PASSWORD: zod.string().optional(),

        // ─── Compose-managed platform services ───────────────────────────
        // Flat env convention (single source of truth for the container env):
        //   MANAGED_<SERVICE>_ENABLED=true
        //   MANAGED_<SERVICE>_<CONFIG_PATH_KEY>=value      e.g. MANAGED_GLOBAL_DB_URL
        // The nested `managedServicesSchema` below SPLITS these flat variables
        // back into `managed[serviceName].configPathKey` / `.enabled` so code
        // reads `managed.globalDb.url`, `managed.redis.enabled`, … — the zod
        // check is the split point (validating the nested shape at runtime).
        //
        // Managed service = the deployment owns the service (Docker Compose or
        // an operator). When MANAGED_<SERVICE>_ENABLED=true the matching
        // supervisor SKIPS registration → the API neither spawns nor
        // supervises it, and consumers use the MANAGED_<SERVICE>_* endpoint.
        // When false (default) the API supervises the service itself.
        MANAGED_GLOBAL_DB_ENABLED: booleanEnv().default(false),
        MANAGED_GLOBAL_DB_URL: zod.string().optional(),
        MANAGED_GLOBAL_DB_HOST: zod.string().optional().default("global-db"),
        MANAGED_GLOBAL_DB_PORT: zod.coerce.number().int().min(1).max(65535).default(5432),
        MANAGED_GLOBAL_DB_USER: zod.string().optional().default("deployer"),
        MANAGED_GLOBAL_DB_PASSWORD: zod.string().optional().default("deployer"),
        MANAGED_GLOBAL_DB_NAME: zod.string().optional().default("deployer"),
        MANAGED_GLOBAL_DB_IMAGE: zod.string().min(1).default("postgres:16-alpine"),

        MANAGED_REDIS_ENABLED: booleanEnv().default(false),
        MANAGED_REDIS_URL: zod.string().optional(),
        MANAGED_REDIS_HOST: zod.string().optional().default("redis"),
        MANAGED_REDIS_PORT: zod.coerce.number().int().min(1).max(65535).default(6379),
        MANAGED_REDIS_PASSWORD: zod.string().optional(),

        MANAGED_LOCAL_DB_ENABLED: booleanEnv().default(false),
        MANAGED_LOCAL_DB_PATH: zod.string().optional(),

        // ─── Traefik (API ingress) — externally managed ──────────────────
        // When MANAGED_TRAEFIK_ENABLED=true the deployment (compose/operator)
        // owns the Traefik ingress — the TraefikSupervisor skips spawning and
        // all consumers use MANAGED_TRAEFIK_* to reach it.
        MANAGED_TRAEFIK_ENABLED: booleanEnv().default(false),
        MANAGED_TRAEFIK_HOST: zod.string().optional().default("traefik"),
        MANAGED_TRAEFIK_IMAGE: zod.string().min(1).default("traefik:v3.3"),
        MANAGED_TRAEFIK_HTTP_PORT: zod.coerce.number().int().min(1).max(65535).default(80),
        MANAGED_TRAEFIK_WEB_HOST: emptyableString().optional(),
        MANAGED_TRAEFIK_API_HOST: emptyableString().optional(),

        // ─── WireGuard (mesh private overlay) ────────────────────────────
        // The mesh nodes form a WireGuard mesh LAYER (not an orchestrator):
        // each node runs a wireguard sidecar with a persisted private key +
        // peer pubkeys, each gets a 10.x.y.z overlay IP, and nodes reach each
        // other over the overlay (mesh dial/control plane, plus the drizzle
        // gateway can attach to it to reach internal DB services).
        // MANAGED_WIREGUARD_ENABLED=true → the deployment owns the sidecar
        // (compose) and the WireGuardSupervisor skips spawning.
        MANAGED_WIREGUARD_ENABLED: booleanEnv().default(false),
        // Unique overlay IP for THIS node (required when enabled) — e.g. 10.0.0.1.
        MANAGED_WIREGUARD_IP: zod.string().optional(),
        // Overlay network /24 — dev default 10.0.0.0/24.
        MANAGED_WIREGUARD_NETWORK: zod.string().optional().default("10.0.0.0/24"),
        // This node's private key (base64). Auto-generated + persisted in the
        // state volume when absent.
        MANAGED_WIREGUARD_PRIVATE_KEY: zod.string().optional(),
        // Comma-separated peer list: "<ip>|<pubkey>|<endpoint-host>:<port>" —
        // e.g. "10.0.0.2|<base64pub>|mesh-node-2:51820".
        MANAGED_WIREGUARD_PEERS: zod.string().optional(),
        // Port the wireguard sidecar listens on (UDP).
        MANAGED_WIREGUARD_PORT: zod.coerce.number().int().min(1).max(65535).default(51820),
        // Image of the wireguard sidecar.
        MANAGED_WIREGUARD_IMAGE: zod.string().min(1).default("linuxserver/wireguard:latest"),
        // Named docker volume persisting wg keys + config.
        MANAGED_WIREGUARD_STATE_VOLUME: zod.string().optional().default("deployer-wireguard-state"),

        // ─── Database service primitive (scaled Postgres instances) ──────
        // A "database service" is a scaled set of managed Postgres instances
        // (one per replica) reachable in the private overlay + shared network
        // by alias, so drizzle-gateway (and other services) can connect to
        // each by name. MANAGED_DATABASE_ENABLED=true → the deployment owns
        // them (compose) and DatabaseServiceSupervisor skips. The instance
        // list is generated from MANAGED_DATABASE_INSTANCES (comma-separated
        // names) with one container per name.
        MANAGED_DATABASE_ENABLED: booleanEnv().default(false),
        // Comma-separated instance names, e.g. "db-a,db-b" → containers
        // "deployer-database-db-a", "deployer-database-db-b".
        MANAGED_DATABASE_INSTANCES: zod.string().optional(),
        MANAGED_DATABASE_URL: zod.string().optional(),
        MANAGED_DATABASE_HOST: zod.string().optional().default("database"),
        MANAGED_DATABASE_PORT: zod.coerce.number().int().min(1).max(65535).default(5432),
        MANAGED_DATABASE_USER: zod.string().optional().default("deployer"),
        MANAGED_DATABASE_PASSWORD: zod.string().optional().default("deployer"),
        MANAGED_DATABASE_NAME: zod.string().optional().default("deployer"),
        MANAGED_DATABASE_IMAGE: zod.string().min(1).default("postgres:16-alpine"),
        // Base for per-instance data volumes (volume = <base>-<instance>).
        MANAGED_DATABASE_DATA_VOLUME_BASE: zod.string().optional().default("deployer-database-data"),

        BACKUP_PATH: zod.string().optional().default("/tmp/backups"),
        STORAGE_PATH: zod.string().optional().default("/tmp/storage"),

        TRAEFIK_CONFIG_BASE_PATH: zod.string().optional().default("/app/traefik-configs"),
        TRAEFIK_BACKUP_PATH: zod.string().optional().default("/app/traefik-configs/backups"),
        TRAEFIK_STARTUP_SYNC_ENABLED: booleanEnv().optional().default(true),
        TRAEFIK_FAIL_ON_STARTUP_ERROR: booleanEnv().optional().default(false),
        TRAEFIK_CLEANUP_ON_STARTUP: booleanEnv().optional().default(false),
        // Named docker volume that SHARES the generated configs between the
        // API container (writes) and the Traefik container (mount read-only).
        // Binding the VOLUME NAME (not a container path) into Traefik is what
        // makes the file provider actually see the config — a container
        // -internal path is invisible to the host.
        TRAEFIK_CONFIG_VOLUME: zod.string().min(1).default("deployer-traefik-config"),

        // ─── Direct-port proxy (failover ingress) ─────────────────────────
        // The API-centric platform publishes NO service ports: everything
        // goes through Traefik (api.<prefix>deployer.localhost /
        // web.<prefix>deployer.localhost over the entry port). When Traefik
        // FAILS (entry port unavailable → degraded), this supervised nginx
        // container takes over the API/web host ports and forwards to the
        // container names over the private platform network — the rescue
        // lane the operator uses to reach the platform and reconfigure the
        // entry port. As soon as Traefik converges again, the proxy removes
        // itself. Disable to suppress the failover entirely.
        DEPLOYER_DIRECT_PROXY_ENABLED: booleanEnv().default(true),
        // Image for the fallback nginx proxy container.
        DEPLOYER_DIRECT_PROXY_IMAGE: zod.string().min(1).default("nginx:alpine"),
        // API container name on the platform network (docker embedded DNS).
        // Default: THIS API container's own name (resolved from docker).
        DIRECT_PROXY_API_TARGET: emptyableString().optional(),
        // Web container name on the platform network. Default: the managed
        // web container (deployer-managed-web[-prefix]); set it to the
        // compose-owned web (e.g. web-dev) in dev side-by-side stacks.
        DIRECT_PROXY_WEB_TARGET: emptyableString().optional(),
        // Host port the fallback proxy publishes for the web surface.
        DIRECT_PROXY_WEB_HOST_PORT: zod.coerce.number().int().min(1).max(65535).default(3000),
        // Named docker volume sharing the generated nginx.conf between the
        // API container (writes) and the proxy container (mount read-only).
        DIRECT_PROXY_CONFIG_VOLUME: zod.string().min(1).default("deployer-port-proxy-config"),
        // API-side mount of the proxy config volume (compose declares it).
        DIRECT_PROXY_CONFIG_BASE_PATH: zod.string().optional().default("/app/port-proxy-config"),

        // Database seeding & bootstrap
        // Using .default() which reads from process.env via expandVariables
        DISABLE_AUTO_SCAN: booleanEnv().default(false),
        ENABLE_SEEDING: booleanEnv().default(false),
        SKIP_MIGRATIONS: booleanEnv().optional().default(false),

        // Scanner runner shared container
        SCANNER_RUNNER_IMAGE: zod.string().optional().default("deployer-scanner-runner:latest"),
        SCANNER_APP_IDLE_TIMEOUT_MS: zod.coerce.number().int().min(60_000).optional().default(600_000),
        // Absolute path to the docker/scanner-runner build context — only
        // needed when the default cwd-relative resolution cannot find it.
        SCANNER_RUNNER_BUILD_CONTEXT: zod.string().optional(),

        // Mesh / distributed runtime
        MESH_NODE_ID: zod.string().optional(),
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
    .superRefine((data, ctx) => {
        // Ensure BETTER_AUTH_SECRET matches AUTH_SECRET when both provided
        if (data.BETTER_AUTH_SECRET && data.AUTH_SECRET && data.BETTER_AUTH_SECRET !== data.AUTH_SECRET) {
            ctx.addIssue({
                code: zod.ZodIssueCode.custom,
                message: "BETTER_AUTH_SECRET must match AUTH_SECRET when provided",
                path: ["BETTER_AUTH_SECRET"],
            });
        }

        // SETUP_AUTO=true without SETUP_AUTO_DATABASE_URL: Postgres is
        // auto-provisioned on demand via PostgresContainerService (dockerode).
        // SETUP_AUTO=true with SETUP_AUTO_DATABASE_URL: use the URL directly
        // (probed — fails boot hard when unreachable), persist to SQLite.
        // SETUP_AUTO=false (production): database URL is resolved by the
        // setup sub-app from the local SQLite node_config — never from env
        // at runtime.
        // There is NO "local-only" (no-Postgres) mode — the global database
        // is mandatory even in dev.
    });

// ============================================================================
// Managed Services — nested split of the flat MANAGED_<SERVICE>_<KEY> env vars
// ============================================================================
//
// The container env is FLAT (MANAGED_GLOBAL_DB_ENABLED, MANAGED_GLOBAL_DB_URL,
// …). For ergonomic, typed access the flat variables are SPLIT back into a
// nested shape validated by `managedServicesSchema`:
//
//   managedServicesSchema.shape.globalDb.enabled   // boolean (MANAGED_GLOBAL_DB_ENABLED)
//   managedServicesSchema.shape.globalDb.url       // string (MANAGED_GLOBAL_DB_URL)
//   managedServicesSchema.shape.redis.enabled      // boolean (MANAGED_REDIS_ENABLED)
//   managedServicesSchema.shape.tailscale.authKey  // string (MANAGED_TAILSCALE_AUTHKEY)
//
// `splitManagedEnv(env)` maps the flat record onto the nested schema — it is
// THE split point: consumers pass `env.get("managed")`-style flat objects and
// get back `managed[serviceName].configPathKey` / `.enabled`.
export const managedGlobalDbSchema = zod.object({
    enabled: booleanEnv().default(false),
    url: zod.string().optional(),
    host: zod.string().optional().default("global-db"),
    port: zod.coerce.number().int().min(1).max(65535).default(5432),
    user: zod.string().optional().default("deployer"),
    password: zod.string().optional().default("deployer"),
    name: zod.string().optional().default("deployer"),
    image: zod.string().min(1).default("postgres:16-alpine"),
});
export type ManagedGlobalDbEnv = zod.infer<typeof managedGlobalDbSchema>;

export const managedRedisSchema = zod.object({
    enabled: booleanEnv().default(false),
    url: zod.string().optional(),
    host: zod.string().optional().default("redis"),
    port: zod.coerce.number().int().min(1).max(65535).default(6379),
    password: zod.string().optional(),
});
export type ManagedRedisEnv = zod.infer<typeof managedRedisSchema>;

export const managedLocalDbSchema = zod.object({
    enabled: booleanEnv().default(false),
    path: zod.string().optional(),
});
export type ManagedLocalDbEnv = zod.infer<typeof managedLocalDbSchema>;

export const managedTraefikSchema = zod.object({
    enabled: booleanEnv().default(false),
    host: zod.string().optional().default("traefik"),
    image: zod.string().min(1).default("traefik:v3.3"),
    httpPort: zod.coerce.number().int().min(1).max(65535).default(80),
    webHost: emptyableString().optional(),
    apiHost: emptyableString().optional(),
});
export type ManagedTraefikEnv = zod.infer<typeof managedTraefikSchema>;

export const managedWireguardSchema = zod.object({
    enabled: booleanEnv().default(false),
    ip: zod.string().optional(),
    network: zod.string().optional().default("10.0.0.0/24"),
    privateKey: zod.string().optional(),
    peers: zod.string().optional(),
    port: zod.coerce.number().int().min(1).max(65535).default(51820),
    image: zod.string().min(1).default("linuxserver/wireguard:latest"),
    stateVolume: zod.string().optional().default("deployer-wireguard-state"),
});
export type ManagedWireguardEnv = zod.infer<typeof managedWireguardSchema>;

export const managedDatabaseSchema = zod.object({
    enabled: booleanEnv().default(false),
    instances: zod.string().optional(),
    url: zod.string().optional(),
    host: zod.string().optional().default("database"),
    port: zod.coerce.number().int().min(1).max(65535).default(5432),
    user: zod.string().optional().default("deployer"),
    password: zod.string().optional().default("deployer"),
    name: zod.string().optional().default("deployer"),
    image: zod.string().min(1).default("postgres:16-alpine"),
    dataVolumeBase: zod.string().optional().default("deployer-database-data"),
});
export type ManagedDatabaseEnv = zod.infer<typeof managedDatabaseSchema>;

export const managedServicesSchema = zod.object({
    globalDb: managedGlobalDbSchema,
    redis: managedRedisSchema,
    localDb: managedLocalDbSchema,
    traefik: managedTraefikSchema,
    wireguard: managedWireguardSchema,
    database: managedDatabaseSchema,
});
export type ManagedServicesEnv = zod.infer<typeof managedServicesSchema>;

/**
 * Build the connection URL for a compose/operator-managed global Postgres.
 * An explicit `MANAGED_GLOBAL_DB_URL` wins; otherwise the parts
 * (HOST/PORT/USER/PASSWORD/NAME) are assembled with the schema defaults.
 * Shared by the dev bootstrap (SetupDevService) and the shared pool factory
 * (GlobalDatabaseModule) so the URL is derived in exactly ONE place.
 */
export function resolveManagedGlobalDbUrl(managed: ManagedGlobalDbEnv): string {
    const explicit = managed.url;
    if (explicit !== undefined && explicit !== "") return explicit;
    const host = managed.host ?? "global-db";
    const port = managed.port ?? 5432;
    const user = managed.user ?? "deployer";
    const password = managed.password ?? "deployer";
    const database = managed.name ?? "deployer";
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

/** Service name keys accepted by the managed-env split. */
export type ManagedServiceName = keyof ManagedServicesEnv;

/** Flat→nested mapper for one managed service (key ⇒ flat env suffix). */
const MANAGED_SERVICE_FLAT_KEYS: Record<ManagedServiceName, Record<string, string>> = {
    globalDb: {
        enabled: "MANAGED_GLOBAL_DB_ENABLED",
        url: "MANAGED_GLOBAL_DB_URL",
        host: "MANAGED_GLOBAL_DB_HOST",
        port: "MANAGED_GLOBAL_DB_PORT",
        user: "MANAGED_GLOBAL_DB_USER",
        password: "MANAGED_GLOBAL_DB_PASSWORD",
        name: "MANAGED_GLOBAL_DB_NAME",
        image: "MANAGED_GLOBAL_DB_IMAGE",
    },
    redis: {
        enabled: "MANAGED_REDIS_ENABLED",
        url: "MANAGED_REDIS_URL",
        host: "MANAGED_REDIS_HOST",
        port: "MANAGED_REDIS_PORT",
        password: "MANAGED_REDIS_PASSWORD",
    },
    localDb: {
        enabled: "MANAGED_LOCAL_DB_ENABLED",
        path: "MANAGED_LOCAL_DB_PATH",
    },
    traefik: {
        enabled: "MANAGED_TRAEFIK_ENABLED",
        host: "MANAGED_TRAEFIK_HOST",
        image: "MANAGED_TRAEFIK_IMAGE",
        httpPort: "MANAGED_TRAEFIK_HTTP_PORT",
        webHost: "MANAGED_TRAEFIK_WEB_HOST",
        apiHost: "MANAGED_TRAEFIK_API_HOST",
    },
    wireguard: {
        enabled: "MANAGED_WIREGUARD_ENABLED",
        ip: "MANAGED_WIREGUARD_IP",
        network: "MANAGED_WIREGUARD_NETWORK",
        privateKey: "MANAGED_WIREGUARD_PRIVATE_KEY",
        peers: "MANAGED_WIREGUARD_PEERS",
        port: "MANAGED_WIREGUARD_PORT",
        image: "MANAGED_WIREGUARD_IMAGE",
        stateVolume: "MANAGED_WIREGUARD_STATE_VOLUME",
    },
    database: {
        enabled: "MANAGED_DATABASE_ENABLED",
        instances: "MANAGED_DATABASE_INSTANCES",
        url: "MANAGED_DATABASE_URL",
        host: "MANAGED_DATABASE_HOST",
        port: "MANAGED_DATABASE_PORT",
        user: "MANAGED_DATABASE_USER",
        password: "MANAGED_DATABASE_PASSWORD",
        name: "MANAGED_DATABASE_NAME",
        image: "MANAGED_DATABASE_IMAGE",
        dataVolumeBase: "MANAGED_DATABASE_DATA_VOLUME_BASE",
    },
};

/** Service name → its flat-key mapping (each service key maps to exactly one flat env name). */
type ManagedServiceFlatMap = {
    [Service in ManagedServiceName]: Record<string, string>;
};

const MANAGED_SERVICE_FLAT_MAP = MANAGED_SERVICE_FLAT_KEYS as ManagedServiceFlatMap;

/** Flat env source — either a parsed record or an EnvService-like getter. */
type ManagedEnvSource = Record<string, unknown> | { get(key: string): unknown };

/** Read one flat key from the source (getter or plain record). */
const readFlat = (source: ManagedEnvSource, key: string): unknown =>
    typeof (source as { get?: unknown }).get === "function"
        ? (source as { get(key: string): unknown }).get(key)
        : (source as Record<string, unknown>)[key];

/**
 * Split the flat `MANAGED_<SERVICE>_<KEY>` env into the nested
 * `managed[serviceName].enabled` / `.configPathKey` shape.
 *
 * @param source   the env source — an EnvService-like `{ get(key) }` (typical:
 *                 pass the API's `EnvService`) or a plain flat record.
 *                 Missing keys → skipped (the nested schema's `.default()`
 *                 fills the rest).
 */
export function splitManagedEnv(source: ManagedEnvSource): ManagedServicesEnv {
    const read = (service: ManagedServiceName, key: string, fallback = ""): unknown =>
        readFlat(source, MANAGED_SERVICE_FLAT_KEYS[service][key] ?? fallback);

    return managedServicesSchema.parse({
        globalDb: {
            enabled: read("globalDb", "enabled"),
            url: read("globalDb", "url"),
            host: read("globalDb", "host"),
            port: read("globalDb", "port"),
            user: read("globalDb", "user"),
            password: read("globalDb", "password"),
            name: read("globalDb", "name"),
            image: read("globalDb", "image"),
        },
        redis: {
            enabled: read("redis", "enabled"),
            url: read("redis", "url"),
            host: read("redis", "host"),
            port: read("redis", "port"),
            password: read("redis", "password"),
        },
        localDb: {
            enabled: read("localDb", "enabled"),
            path: read("localDb", "path"),
        },
        traefik: {
            enabled: read("traefik", "enabled"),
            host: read("traefik", "host"),
            image: read("traefik", "image"),
            httpPort: read("traefik", "httpPort"),
            webHost: read("traefik", "webHost"),
            apiHost: read("traefik", "apiHost"),
        },
        wireguard: {
            enabled: read("wireguard", "enabled"),
            ip: read("wireguard", "ip"),
            network: read("wireguard", "network"),
            privateKey: read("wireguard", "privateKey"),
            peers: read("wireguard", "peers"),
            port: read("wireguard", "port"),
            image: read("wireguard", "image"),
            stateVolume: read("wireguard", "stateVolume"),
        },
        database: {
            enabled: read("database", "enabled"),
            instances: read("database", "instances"),
            url: read("database", "url"),
            host: read("database", "host"),
            port: read("database", "port"),
            user: read("database", "user"),
            password: read("database", "password"),
            name: read("database", "name"),
            image: read("database", "image"),
            dataVolumeBase: read("database", "dataVolumeBase"),
        },
    }) as ManagedServicesEnv;
}

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

        // ─── App-instance identity (api-centric deployment) ───
        // Managed mode: the API provisions this token into the container env.
        APP_INSTANCE_TOKEN: zod.string().min(1).optional(),
        // BYO mode: credentials of ANY account on the target API, used once
        // at boot to register this web instance and mint its own token.
        // `emptyableString` tolerates compose's `${VAR:-}` which yields "".
        DEPLOYER_INSTANCE_LABEL: emptyableString(),
        DEPLOYER_INSTANCE_EMAIL: emptyableString(3),
        DEPLOYER_INSTANCE_PASSWORD: emptyableString(),
        // Override the server-side token persistence path.
        APP_INSTANCE_TOKEN_PATH: emptyableString(),

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

        // Context-aware debug filter used by browser/server web loggers.
        NEXT_PUBLIC_APP_DEBUG_CONTEXT_FILTER: zod.string().optional().default(""),

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
export type AllEnv = zod.infer<typeof allEnvSchema>;

// ============================================================================
// Re-export Everything
// ============================================================================

export { trimTrailingSlash, guardedUrl, parseDebugScopes } from "./utils";
export * from "./constants";
export * from "./validate";

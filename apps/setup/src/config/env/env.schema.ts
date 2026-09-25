import z from "zod/v4";

/**
 * The setup app's OWN environment contract.
 *
 * Deliberately separate from the API's (`apiEnvSchema`). The setup app runs
 * before the platform exists and needs a different, much smaller set of
 * variables — no database URL, no auth secret, no supervisor toggles. Sharing
 * one schema between the two apps would mean each one validating (and
 * requiring defaults for) variables it never uses.
 *
 * This file is the reason `@repo/nest-env` takes a schema instead of shipping
 * one: the mechanism is shared, the contract is not.
 */
export const setupEnvSchema = z.object({
  /** Port the setup app listens on. Internal only — Traefik fronts it. */
  SETUP_APP_PORT: z.coerce.number().int().positive().default(3016),

  /**
   * `dev` waits for the API (compose manages it); `prod` creates the API as a
   * swarm service from `DEPLOYER_API_IMAGE`.
   */
  SETUP_MODE: z.enum(["dev", "prod"]).default("dev"),

  /** Where the full API answers, in dev. Unused in prod (setup creates it). */
  SETUP_API_URL: z.string().optional(),

  /** The image tag setup schedules on the swarm in prod mode. */
  DEPLOYER_API_IMAGE: z.string().optional(),

  /** How many API replicas to schedule. */
  DEPLOYER_API_REPLICAS: z.coerce.number().int().positive().default(1),

  /** Tenant prefix for hostname and network naming. */
  DEPLOYER_PREFIX: z.string().default(""),

  // ─── Docker engine ────────────────────────────────────────────────────────
  // Setup drives the engine directly (swarm init/join, service creation), so
  // it needs the same connection contract the API uses. Declared HERE rather
  // than imported from the API's schema: each app validates what IT reads, and
  // a shared schema would force setup to require variables it never touches.
  DOCKER_HOST: z.string().default("/var/run/docker.sock"),
  DOCKER_PORT: z.coerce.number().int().positive().optional(),
  /** Only read to satisfy the package's scanner contract; setup never scans. */
  SCANNER_RUNNER_IMAGE: z.string().optional(),

  // ─── Swarm participation ──────────────────────────────────────────────────
  // These are the FIRST-RUN defaults, consulted only until the wizard persists
  // a choice in `node_config.swarmConfig` — which then wins. They let an
  // unattended install (`SETUP_AUTO`) converge without touching the UI.
  SWARM_MODE: z.enum(["create", "join"]).default("create"),
  SWARM_POLICY: z.enum(["auto", "manager", "worker"]).default("auto"),
  /** Present means "join this fleet" — the cluster entry mode is derived from it. */
  SWARM_JOIN_TOKEN: z.string().optional(),
  /** Comma-separated control-plane addresses the joiner dials. */
  SWARM_JOIN_ADDRS: z.string().optional(),
  SWARM_ADVERTISE_ADDR: z.string().optional(),
  SWARM_QUORUM_MAX: z.coerce.number().int().min(1).default(3),
  /** Overlay IP peers dial when no explicit advertise address is set. */
  MANAGED_WIREGUARD_IP: z.string().optional(),
  /** This node's own public URL — the last-resort control-plane candidate. */
  APP_URL: z.string().optional(),

  // ─── Election timings ─────────────────────────────────────────────────────
  // Setup does NOT run the election loop (the API does); the values are read
  // only to satisfy `SwarmModuleOptions`, which requires the full contract.
  SWARM_ELECTION_EVAL_STABLE_MS: z.coerce.number().int().min(500).optional(),
  SWARM_ELECTION_EVAL_VOLATILE_MS: z.coerce.number().int().min(250).optional(),
  SWARM_ELECTION_COOLDOWN_MS: z.coerce.number().int().min(0).optional(),
  SWARM_ELECTION_DELTA_MASTER: z.coerce.number().min(0).max(1).optional(),
  SWARM_HEARTBEAT_TTL_MS: z.coerce.number().int().min(1000).optional(),
  SWARM_MASTER_GRACE_MS: z.coerce.number().int().min(0).optional(),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type SetupEnv = z.infer<typeof setupEnvSchema>;

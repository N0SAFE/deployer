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

  /**
   * The port the API listens on inside the platform network.
   *
   * Read rather than hardcoded because the correct value genuinely differs by
   * environment (dev publishes 3005, prod 3001), so a constant would be right in
   * one mode and silently wrong in the other — producing an ingress backend URL
   * Traefik cannot reach. The default matches the API's own `app.config.ts`
   * fallback.
   */
  SETUP_API_PORT: z.coerce.number().int().min(1).max(65535).default(3005),

  /**
   * Directory the live Traefik file provider watches.
   *
   * SAME variable and default as the API's own config services, because both
   * processes must resolve the SAME mount: setup writes the handover into it and
   * the API later rewrites its own files there. A mismatch would make the
   * handover look like "Traefik ignores us" rather than a configuration error.
   */
  TRAEFIK_CONFIG_BASE_PATH: z.string().default("/app/traefik-configs"),

  /**
   * A Postgres the compose profile manages and hands to the platform.
   *
   * Read by `SetupGateService` when the operator supplies no URL of their own:
   * it is the address the API must read from `node_config` on boot. Declared
   * HERE rather than in the API's schema because setup is what persists it —
   * and the API never reads this variable at all, only the row setup writes.
   */
  MANAGED_GLOBAL_DB_URL: z.string().optional(),

  /** The image tag setup schedules on the swarm in prod mode. */
  DEPLOYER_API_IMAGE: z.string().optional(),

  /** How many API replicas to schedule. */
  DEPLOYER_API_REPLICAS: z.coerce.number().int().positive().default(1),

  /** Tenant prefix for hostname and network naming. */
  DEPLOYER_PREFIX: z.string().default(""),

  /**
   * The local SQLite file holding node state (`node_config`, `cluster_node`).
   *
   * SAME FILE AS THE API'S, and that is the point: setup writes the swarm
   * participation decision and the API READS it, so the two processes must
   * mount the same path. The default matches the API's schema so a single
   * compose volume satisfies both.
   */
  NODE_LOCAL_DB_PATH: z.string().default("/app/data/local.db"),

  // ─── Docker engine ────────────────────────────────────────────────────────
  // Setup drives the engine directly (swarm init/join, service creation), so
  // it needs the same connection contract the API uses. Declared HERE rather
  // than imported from the API's schema: each app validates what IT reads, and
  // a shared schema would force setup to require variables it never touches.
  DOCKER_HOST: z.string().default("/var/run/docker.sock"),
  DOCKER_PORT: z.coerce.number().int().positive().optional(),
  /** Only read to satisfy the package's scanner contract; setup never scans. */
  SCANNER_RUNNER_IMAGE: z.string().optional(),

  // ─── Swarm admission ──────────────────────────────────────────────────────
  //
  // ── WHAT IS *NOT* HERE, AND WHY ───────────────────────────────────────────
  // There is deliberately no `SWARM_MODE` / `SWARM_POLICY` / `SWARM_JOIN_TOKEN` /
  // `SWARM_JOIN_ADDRS`. Those existed as FIRST-RUN DEFAULTS for an unattended
  // install, and they are unreachable now:
  //
  //   - `SwarmBootstrapService.onModuleInit()` REFUSES to converge before
  //     `setupDone()`, so the engine is never touched on env-derived defaults;
  //   - the wizard ALWAYS writes the full `node_config.swarmConfig`
  //     (`local` → create, `remote` → join), and `effectiveConfig()` prefers the
  //     persisted row, so the env fallback can never be selected;
  //   - the join path cannot run here at all: `ClusterOrchestratorService` only
  //     ever starts `{ kind: "found" }`. A joining node gets its token and
  //     control-plane addresses from the FLEET's grant, consumed by the API's
  //     
  //     `RemoteInitializationService` — not from this app's environment.
  //
  // Their comment also referenced `SETUP_AUTO`, a flag deleted with the
  // gate inversion — so they were documented by a mechanism that no longer
  // exists.
  //
  // Leaving them in place was not harmless: compose passes unset optionals as
  // EMPTY STRINGS, and `"".split(",")` is `[""]` — a one-element list of
  // nothing — which passed the "do I have addresses?" guard and then failed the
  // schema's per-item `min(1)`.

  /**
   * Address this node advertises for cluster control traffic.
   *
   * NOT a participation default, which is why it stays: it is read on EVERY
   * boot by `SwarmBootstrapService.advertiseAddr()`, because `docker swarm init`
   * refuses to infer one on a host with several candidates
   * (`could not choose an IP address to advertise`). The wizard collects a value
   * into `swarmConfig` too, but a FOUNDING node needs an address before that row
   * exists.
   */
  SWARM_ADVERTISE_ADDR: z.string().optional(),

  /**
   * Cap on the number of managers (the election quorum target).
   *
   * Also not a participation default: it is not a field of
   * `node_config.swarmConfig` at all, so the package's `join.quorumMax` can only
   * come from here. `SwarmJoinGrantService` reads it when issuing a join grant.
   */
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

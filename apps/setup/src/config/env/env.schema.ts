import z from "zod/v4";
import { booleanEnv } from "@repo/env";

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

  // ─── Traefik (the ingress this app SUPERVISES before the API exists) ──────
  //
  // ── WHY SETUP RUNS TRAEFIK AT ALL ─────────────────────────────────────────
  // This app publishes NO ports and is reachable ONLY through the ingress. The
  // API is the process that normally supervises Traefik, but the API cannot
  // start until setup's gate opens — and the gate cannot open until an operator
  // loads the wizard. Without a bootstrap ingress that is a deadlock:
  //
  //   setup serves the wizard on 3016, reachable only via Traefik
  //     → no Traefik exists (compose manages none in dev-supervised/prod)
  //     → nobody can load the wizard
  //     → /setup/health never turns 200
  //     → the API never starts
  //     → and the API is what supervises Traefik.  ✗
  //
  // So the ingress has TWO incarnations (plan §9), one per side of the gate:
  //
  //   State A — BOOTSTRAP (here): a plain container, no swarm involved. It
  //             exists so setup is reachable at all, and it needs no cluster.
  //   State B — SWARM: the API's `TraefikSupervisorService` promotes it to a
  //             GLOBAL swarm service once the cluster and the API exist.
  //
  // Both use the SAME container name (`deployer-traefik`), the SAME entry port
  // and the SAME config volume, so the promotion changes how it RUNS without
  // changing what Traefik IS — no hostname ever changes owner.

  /**
   * Whether the DEPLOYMENT already owns the ingress (compose / operator).
   *
   * ── WHY THIS GATE IS ESSENTIAL, NOT A CONVENIENCE ──────────────────────────
   * The entry port is a HOST port and only one process can hold it. In the plain
   * `dev` profile compose runs its own Traefik (published on :80,
   * `MANAGED_TRAEFIK_ENABLED=true`), so starting a bootstrap ingress here would
   * fail to bind — or worse, silently contend for the port and leave whichever
   * started second dead.
   *
   * So the rule is the SAME one the API's supervisor applies: if the deployment
   * owns the ingress, this app only ROUTES through it (which it already does by
   * writing `dynamic-setup.yml` into the shared config volume) and never runs
   * one.
   *
   * `true`  → plain `dev`: compose runs Traefik; this app starts none.
   * `false` → `dev-supervised` / `prod`: nothing runs Traefik; this app does,
   *           and hands the port to the swarm incarnation at the gate.
   *
   * SAME variable name and default as the API's schema reads, so both apps agree
   * on who owns the ingress by construction rather than by convention.
   */
  MANAGED_TRAEFIK_ENABLED: booleanEnv().default(false),

  /**
   * Image for the bootstrap ingress.
   *
   * SAME variable the API's `TraefikSupervisorService` runs
   * (`DEPLOYER_TRAEFIK_IMAGE`), because the bootstrap container is PROMOTED into
   * that swarm service rather than replaced by it — so both incarnations must
   * agree on the image or the promotion would silently change the ingress.
   *
   * >= v3.6 is required for the swarm side: Traefik <= 3.5 hardcodes Docker
   * Engine API 1.24, which Engine >= 25 rejects, so its docker provider never
   * reads a single container label and label-based routing silently stops
   * working. There is no flag or env workaround.
   */
  DEPLOYER_TRAEFIK_IMAGE: z.string().min(1).default("traefik:v3.6.10"),

  /**
   * Host port the ingress publishes. Default 80.
   *
   * SAME variable the API's supervisor resolves, so the bootstrap and the
   * promoted swarm service bind the SAME port. A mismatch is not cosmetic
   * drift: the promoted service would fail to bind and Traefik would go
   * DEGRADED on a port nobody asked for.
   *
   * The persisted platform setting `ingress.entry_port` overrides this once the
   * API owns the ingress — which is why setup RELEASES this port at handover
   * instead of holding it.
   */
  DEPLOYER_TRAEFIK_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(80),

  /**
   * Named volume holding the generated dynamic config.
   *
   * Mounted read-only at `/config` inside the ingress, which is the directory
   * its FILE provider watches. This is the same volume compose mounts at
   * `/app/traefik-configs` in this container — that shared mount is the entire
   * contract between the two processes, and it is why `IngressHandoverService`
   * can publish a route without ever talking to Traefik.
   */
  TRAEFIK_CONFIG_VOLUME: z.string().min(1).default("deployer-traefik-config"),

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

  /**
   * The images for the services the API CONVERGES once it is running.
   *
   * ── WHY SETUP OWNS THESE ─────────────────────────────────────────────────
   * Setup is what SCHEDULES the API, so it is the only process that can tell
   * that API which tags to run. Compose produced them (`build-web`, `build-doc`),
   * and the API cannot discover them: it boots inside a container with no access
   * to the compose project, and its own schema declares no default for them.
   *
   * Left unset, the API falls back to the literal defaults in its own services,
   * which do NOT match what the dev producers tag —
   *
   *   producer: deployer-web:dev    API fallback: deployer-web:latest
   *
   * — so the swarm service would be created from a tag that was never built and
   * the dashboard would never converge. Passing the tags through is what makes
   * "the image compose built" and "the image the platform runs" the same thing.
   */
  MANAGED_WEB_APP_IMAGE: z.string().optional(),
  DEPLOYER_REDIS_IMAGE: z.string().optional(),
  DEPLOYER_DIRECT_PROXY_IMAGE: z.string().optional(),

  /** How many API replicas to schedule. */
  DEPLOYER_API_REPLICAS: z.coerce.number().int().positive().default(1),

  /** Tenant prefix for hostname and network naming. */
  DEPLOYER_PREFIX: z.string().default(""),

  /**
   * The volume holding the shared SQLite node state, mounted into the API task.
   *
   * ── WHY THIS IS AN ENV VAR AND NOT A CONSTANT ───────────────────────────
   * Setup SCHEDULES the API, and the task must mount the SAME volume setup
   * itself writes — that is what carries `node_config` (the swarm decision and
   * the database URL) across to the API.
   *
   * Compose names its volumes with the PROJECT prefix
   * (`${COMPOSE_PROJECT_NAME}_api_local_db_data_<profile>`), which a constant
   * cannot know. A hardcoded name therefore mounts a DIFFERENT — and empty —
   * volume than the one setup writes, and the API boots with no node state:
   *
   *   Failed query: select "node_id", "server_url" … (db not ready)
   *
   * The default matches the prod compose file, so a deployment that does not set
   * it keeps working; each profile passes its own name, exactly as
   * `TRAEFIK_CONFIG_VOLUME` already does for the ingress config.
   */
  NODE_LOCAL_DB_VOLUME: z.string().min(1).default("api_local_db_data_prod"),

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

import { Injectable, Logger } from "@nestjs/common";
import { DockerService } from "@repo/nest-docker/services/docker.service";
import { platformOverlayForPrefix } from "@repo/nest-docker/services/docker-supervisor-runtime";
import { toDockerServiceSpec } from "@repo/nest-docker/services/swarm-spec.mapper";

import { EnvService } from "@/config/env/env.module";
import { SetupGateService } from "@/modules/wizard/setup-gate.service";
import { DEFAULT_API_INTERNAL_PORT, type ApiBackend } from "../handover.types";

/**
 * Resolves — and in prod, CREATES — the API that onboarding hands over to.
 *
 * ── THE ONE BEHAVIOURAL DIFFERENCE BETWEEN dev AND prod ──────────────────────
 *
 *   dev   compose owns the API. It already runs, at a stable DNS name, and
 *         setup merely has to point the ingress at it. Nothing is created.
 *   prod  nothing runs the API yet. Setup SCHEDULES it as a swarm service from
 *         a prebuilt image, then hands over to that service's DNS name.
 *
 * One flag (`SETUP_MODE`), two paths, same ending — the plan's §11.4.
 *
 * ── WHY SETUP CREATES IT AND DOES NOT BUILD IT ──────────────────────────────
 * The image already exists: locally it was produced by the compose `build-api`
 * service, in a real deployment it comes from a registry. Building again would
 * be a second source of truth for "what is the API", and an in-container build
 * is impossible in dev anyway (the build context is not mounted). Setup's job is
 * to SCHEDULE a tag it is given, which is why the only input is
 * `DEPLOYER_API_IMAGE`.
 *
 * ── WHY THE SWARM SERVICE, RATHER THAN A PLAIN CONTAINER ────────────────────
 * The cluster exists by this point, and `docker run` on a swarm node produces a
 * container the engine does not manage — no restart policy across nodes, no
 * `service ls` visibility, no placement. Scheduling a service is what makes the
 * API part of the cluster the operator just built, which is the entire premise
 * of the prod path.
 */
@Injectable()
export class ApiServiceProvisioner {
  private readonly logger = new Logger(ApiServiceProvisioner.name);

  constructor(
    private readonly env: EnvService,
    private readonly docker: DockerService,
    private readonly gate: SetupGateService,
  ) {}

  /**
   * The swarm service name for the API.
   *
   * Prefixed like every other platform service (`deployer-traefik`,
   * `deployer-managed-web`) so a multi-tenant node's services stay
   * distinguishable, and so an operator listing services sees one naming scheme.
   */
  serviceName(): string {
    const prefix = this.env.get("DEPLOYER_PREFIX");
    return prefix === "" ? "deployer-api" : `deployer-api-${prefix}`;
  }

  /** The API's port inside the platform network. */
  apiPort(): number {
    return this.env.get("SETUP_API_PORT") ?? DEFAULT_API_INTERNAL_PORT;
  }

  /**
   * Resolve the handover target, creating the service first in prod.
   *
   * Returns a description rather than just a URL because the two modes produce
   * genuinely different backends, and the caller logs which one it got — an
   * operator debugging a 502 needs to know whether Traefik was pointed at a
   * compose container or a swarm task.
   */
  async ensureApi(): Promise<ApiBackend> {
    const mode = this.env.get("SETUP_MODE");

    if (mode === "dev") {
      // compose owns it; `SETUP_API_URL` is the address and is required. A
      // missing value here is a CONFIGURATION error, not a runtime condition to
      // paper over, so it fails loudly instead of inventing a default hostname
      // that would not resolve.
      const url = this.env.get("SETUP_API_URL");
      if (url === undefined || url.length === 0) {
        throw new Error("SETUP_MODE=dev requires SETUP_API_URL (compose owns the API in dev)");
      }
      return {
        kind: "container",
        url: url.replace(/\/+$/, ""),
        detail: "compose-managed API (dev)",
      };
    }

    return await this.createSwarmService();
  }

  /**
   * Schedule the API as a swarm service and return its DNS backend.
   *
   * IDEMPOTENT: an existing service is left alone rather than recreated. Setup
   * must be safely re-runnable, and recreating would restart a healthy API —
   * turning a harmless retry of a later step into an outage.
   */
  private async createSwarmService(): Promise<ApiBackend> {
    const name = this.serviceName();
    const image = this.env.get("DEPLOYER_API_IMAGE");

    if (image === undefined || image.length === 0) {
      throw new Error("SETUP_MODE=prod requires DEPLOYER_API_IMAGE (the tag setup schedules)");
    }

    const existing = await this.findExistingService(name);
    if (existing) {
      this.logger.log(`API swarm service "${name}" already exists — reusing it`);
      return this.backendFor(name, image, "existing swarm service");
    }

    const replicas = this.env.get("DEPLOYER_API_REPLICAS");
    const port = this.apiPort();

    // ── THE OVERLAY MUST EXIST BEFORE THE SERVICE JOINS IT ──────────────────
    // `Networks: [{ Target: <overlay> }]` below attaches the service to an
    // ATTACHABLE overlay. Creating a service against a network that does not
    // exist yet fails, and creating it against the compose BRIDGE instead (which
    // is what the previous hardcoded name did) produces a service whose DNS name
    // is unroutable — `getaddrinfo ENOTFOUND deployer-api` on every forward.
    //
    // Idempotent, and the same call the API's own supervisors make, so the
    // network is created once with identical parameters regardless of which
    // process gets there first.
    const overlay = this.platformNetworkName();
    await this.docker.ensureOverlayNetwork({
      name: overlay,
      driver: "overlay",
      attachable: true,
      ingress: false,
      enableIpv6: false,
      labels: { "deployer.managed": "true", "deployer.platform": "true" },
    });

    // ── SETUP MUST JOIN THE OVERLAY TOO, OR IT CANNOT REACH THE API ─────────
    // Scheduling the service is not enough: a swarm service's name resolves ONLY
    // on a swarm-scoped network, so a setup container sitting on the compose
    // BRIDGE cannot resolve it even while the service runs happily:
    //
    //   Upstream http://deployer-api:3005/setup/stream unreachable:
    //   getaddrinfo ENOTFOUND deployer-api
    //
    // which stalls the handover in `provisioning` forever — the API is up, the
    // ingress routes to it, and the one process that must hand over cannot talk
    // to it.
    //
    // Connecting SELF rather than declaring the network in compose, because the
    // overlay does not exist until this code creates it: compose would need it
    // present before starting the very container that makes it.
    await this.connectSelfToOverlay(overlay);

    this.logger.log(`Creating API swarm service "${name}" from image ${image} (${String(replicas)} replica(s)) on ${overlay}`);

    // ── THE CANONICAL SPEC SHAPE, MAPPED BY THE SHARED MAPPER ───────────────
    // `toDockerServiceSpec` is the ONLY place in the codebase that builds a
    // dockerode service spec (its own module note says so), and it exists
    // because the two shapes are NOT interchangeable: `Networks` belongs on the
    // TASK TEMPLATE, and the platform's own contract uses lowercase keys.
    //
    // Hand-building a spec with raw dockerode keys silently produced a service
    // with an EMPTY `Spec.Networks` — docker accepted it, dropped the field, and
    // attached the task to the default `ingress` network instead. The service
    // then ran happily on the wrong network and its name resolved NOWHERE:
    //
    //   Spec.Networks      : (empty)
    //   Endpoint.VirtualIPs: 4d7mwep40le5  <- that is `ingress`
    //
    // which is why every forward failed with `getaddrinfo ENOTFOUND
    // deployer-api` while `docker service ls` showed 1/1.
    await this.docker.createSwarmService(
      toDockerServiceSpec({
        name,
        image,
        // Replicated rather than global: the API is a stateless HTTP server
        // behind Traefik, so the operator chooses the count. GLOBAL would
        // schedule one task per node, which is not what "API_REPLICAS" means.
        mode: "replicated",
        replicas,
        env: this.serviceEnvironment(port),
        command: [],
        args: [],
        labels: {
          "deployer.platform.role": "api",
        },
        containerLabels: {},
        mounts: [
          // The SAME volume the setup container mounts. `node_config` holds the
          // swarm participation decision and the database URL setup already
          // wrote, and the API is the READER of that single writer's output —
          // so losing this mount would mean the API boots with no idea a
          // cluster exists.
          {
            type: "volume",
            source: this.localDbVolumeName(),
            target: "/app/data",
            readOnly: false,
          },
          // ── THE ENGINE SOCKET, WHICH THE API CANNOT WORK WITHOUT ────────
          // The API SUPERVISES the platform: it creates the managed Postgres,
          // redis, the ingress and the web app as swarm services, and it reads
          // swarm state to do it. Without the socket every one of those calls
          // fails with
          //
          //   Failed to read Swarm info: connect ENOENT /var/run/docker.sock
          //
          // — a continuous error stream, no supervisors converging, and the
          // platform never becomes ready. A swarm task does NOT inherit the
          // socket from the node it runs on (nor from the compose container
          // that created the service), so it must be mounted explicitly.
          {
            type: "bind",
            source: "/var/run/docker.sock",
            target: "/var/run/docker.sock",
            readOnly: false,
          },
        ],
        // ── THE OVERLAY, WITH THE SERVICE NAME AS AN ALIAS ──────────────────
        // This is what makes `deployer-api` resolvable. Without it the task
        // lands on `ingress` and nothing can dial it by name.
        networks: [{ target: overlay, aliases: [name] }],
        // Restart on failure, with backoff: a swarm task that fails during boot
        // (Postgres not yet reachable) must retry rather than wait for an
        // operator. Unlimited attempts would mask a permanently broken image,
        // so the count is bounded.
        healthcheck: null,
        updateConfig: { parallelism: 1, delayMs: 0, order: "start-first", failureAction: "rollback" },
        stopGracePeriodSeconds: 10,
        // vip, not dnsrr: Traefik dials one stable service address and the swarm
        // balances across replicas. `dnsrr` would return every task IP and push
        // balancing to Traefik, which then needs the task list to stay current.
        endpointMode: "vip",
        endpointPorts: [{ protocol: "tcp", targetPort: port, publishedPort: port }],
        placementPreferences: [],
        placementConstraints: [],
        resourcesLimits: {},
        resourcesReservations: {},
        capabilitiesAdd: [],
      }),
    );

    this.logger.log(`API swarm service "${name}" created`);
    return this.backendFor(name, image, "newly created swarm service");
  }

  /**
   * The API's DNS backend inside the overlay.
   *
   * The service name IS the DNS name on a swarm overlay network, so no lookup is
   * needed — and using the alias we registered above means this cannot drift
   * from the `Networks.Aliases` entry.
   */
  private backendFor(name: string, image: string, detail: string): ApiBackend {
    return {
      kind: "swarm",
      url: `http://${name}:${String(this.apiPort())}`,
      serviceName: name,
      detail: `${detail} (${image})`,
    };
  }

  /** Find a service by name, or `null`. */
  private async findExistingService(name: string): Promise<boolean> {
    try {
      await this.docker.inspectSwarmService(name);
      return true;
    } catch {
      // "Not found" is the interesting case and the expected one on first run.
      // Any OTHER engine error will surface on the create call, which reports it
      // with the operation name — swallowing it here would hide the cause.
      return false;
    }
  }

  /**
   * Environment for the API task.
   *
   * DELIBERATELY MINIMAL: only the values a scheduler must supply because the
   * API cannot discover them. Everything else (its own defaults, the managed
   * service toggles) comes from the image's own environment contract, so this
   * list cannot become a second copy of the API's env schema.
   *
   * `NODE_LOCAL_DB_PATH` is the exception that must be explicit: it points at
   * the mounted volume, and the API's own default would resolve inside the
   * container filesystem — a silently empty database rather than an error.
   *
   * ── WHY THE IMAGE TAGS ARE PASSED THROUGH ────────────────────────────────
   * Setup is the process that SCHEDULES this API, so it is the only one that can
   * tell it which images to converge for the rest of the platform. The API
   * cannot discover them: it boots inside a container with no access to the
   * compose project that built them, and its own services fall back to literal
   * defaults that do NOT match what the dev producers tag:
   *
   *   producer: deployer-web:dev     API fallback: deployer-web:latest
   *
   * so the managed-web swarm service would be created from a tag that was never
   * built, and the dashboard would never converge. Only NON-EMPTY values are
   * forwarded, so an unset variable keeps the API's own default rather than
   * overwriting it with an empty string (which would be worse: a service spec
   * with `Image: ""` fails at create time with no hint as to why).
   */
  private serviceEnvironment(port: number): string[] {
    const env = [`NODE_LOCAL_DB_PATH=/app/data/local.db`, `API_PORT=${String(port)}`];

    const prefix = this.env.get("DEPLOYER_PREFIX");
    if (prefix !== "") env.push(`DEPLOYER_PREFIX=${prefix}`);

    // ── THE API'S OWN CONTRACT, WHICH A SCHEDULED TASK CANNOT INHERIT ───────
    // These are REQUIRED by the API's env schema (it refuses to boot without
    // them) and in plain `dev` compose supplies them. A swarm task inherits
    // NOTHING from the compose project, so setup — the process that creates the
    // task — has to pass them or the API crash-loops:
    //
    //   ❌ Environment validation failed:
    //      Invalid input: expected string, received undefined → NEXT_PUBLIC_API_URL
    //      Invalid input: expected string, received undefined → NEXT_PUBLIC_APP_URL
    //
    // They are PUBLIC ORIGINS, not secrets: the API needs its own external URL
    // to build callback links, and the web origin for CORS and trusted origins.
    // Both are derived from the platform hostname rather than hardcoded, so a
    // prefixed deployment gets the right hosts.
    const apiOrigin = this.publicOrigin("api", prefix);
    const webOrigin = this.publicOrigin("web", prefix);
    env.push(`NEXT_PUBLIC_API_URL=${apiOrigin}`);
    env.push(`NEXT_PUBLIC_APP_URL=${webOrigin}`);
    // `APP_URL` is the WEB APP's address as seen from inside the platform
    // network. The managed web app is a swarm service here, so it answers at
    // its service name on the shared network — the same name the supervisor
    // gives it.
    env.push(`APP_URL=${this.managedWebServiceUrl()}`);

    // ── THE SHARED AUTH SECRET, WHICH BOTH APPS MUST AGREE ON ────────────────
    // The API signs the session cookie and the WEB app's middleware decrypts it,
    // so the two must use the same value or a session is valid on one host and
    // invalid on the other. Compose guaranteed that with
    // `BETTER_AUTH_SECRET: ${AUTH_SECRET:-...}`; a swarm task inherits nothing,
    // so it is forwarded here. `BETTER_AUTH_SECRET` is derived from
    // `AUTH_SECRET` rather than read separately — one source of truth, and the
    // web schema REFUSES to boot when they differ.
    const authSecret = this.env.get("AUTH_SECRET");
    env.push(`AUTH_SECRET=${authSecret}`);
    env.push(`BETTER_AUTH_SECRET=${authSecret}`);

    // ── THE SHARED PARENT DOMAIN, WITHOUT WHICH THE WIZARD'S OWN SIGN-IN FAILS ─
    // Better Auth validates the `Origin` header of every auth call. With a plain
    // string `baseURL` (or only a couple of explicit origins) every OTHER host of
    // the deployment is an invalid origin — including `setup.<domain>`, the host
    // the wizard runs on. That surfaced as an `Invalid origin` error on the
    // final "continue to dashboard" click.
    //
    // The API derives a wildcard from `AUTH_BASE_DOMAIN`
    // (`*.deployer.localhost`), which is what makes every subdomain — api, web,
    // doc AND setup — a valid origin from ONE source of truth. A swarm task
    // inherits nothing from compose, so it has to be forwarded here or the API
    // boots with no wildcard at all. Confirmed missing on a live task:
    //
    //   APP_URL=http://deployer-managed-web:3000
    //   NEXT_PUBLIC_APP_URL=http://web.deployer.localhost
    //   (no AUTH_BASE_DOMAIN)  →  setup.deployer.localhost not trusted
    const baseDomain = this.authBaseDomain(prefix);
    env.push(`AUTH_BASE_DOMAIN=${baseDomain}`);
    // Belt and braces: the wildcard covers it, but naming the setup origin
    // explicitly means the wizard's sign-in works even if a deployment sets its
    // own narrower `AUTH_BASE_DOMAIN` that does not include the setup label.
    env.push(`TRUSTED_ORIGINS=${this.publicOrigin("setup", prefix)}`);

    // The tags the API's supervisors build their service specs from.
    const imageVars = [
      "MANAGED_WEB_APP_IMAGE",
      "DEPLOYER_TRAEFIK_IMAGE",
      "DEPLOYER_REDIS_IMAGE",
      "DEPLOYER_DIRECT_PROXY_IMAGE",
    ] as const;
    for (const name of imageVars) {
      const value = this.env.get(name);
      if (value !== undefined && value.length > 0) env.push(`${name}=${value}`);
    }

    // ── THE DASHBOARD DECISION THE OPERATOR MADE IN THE WIZARD ──────────────
    // `MANAGED_WEB_APP_ENABLED` is the API's SEED for `managed_web_app.enabled`
    // in `app_config` (the DB value wins on every later read). Forwarding the
    // wizard's choice here is what makes "enable the managed web app" take
    // effect on a FRESH instance: without it the API boots on its env default,
    // and the operator's answer would be silently discarded.
    //
    // Only forwarded when the operator actually answered, so an unset choice
    // keeps the deployment's own default rather than overriding it with a
    // value nobody picked.
    const managedWeb = this.gate.managedWebEnabled();
    if (managedWeb !== null) {
      env.push(`MANAGED_WEB_APP_ENABLED=${managedWeb ? "true" : "false"}`);
    }

    return env;
  }

  /**
   * The public origin for a platform hostname.
   *
   * Mirrors the hostname scheme the ingress and the API's own
   * `HostnameService` use: `api.deployer.localhost` on a default install, and
   * `<host>.<prefix>deployer.localhost` on a prefixed one. Derived rather than
   * hardcoded so a prefixed deployment does not silently advertise the default
   * host, which would break callbacks and CORS.
   */
  private publicOrigin(host: "api" | "web" | "setup", prefix: string): string {
    // The prefix is a MIDDLE SEGMENT: `api.acme.deployer.localhost`. The dot
    // before it is required — `api.${prefix}deployer.localhost` produced
    // `api.acmedeployer.localhost`, a host that resolves to nothing, and the
    // API was handed that as `NEXT_PUBLIC_API_URL`.
    return prefix === ""
      ? `http://${host}.deployer.localhost`
      : `http://${host}.${prefix}.deployer.localhost`;
  }

  /**
   * The leading-dot parent domain shared by every platform host.
   *
   * `.deployer.localhost`, or `.acme.deployer.localhost` on a prefixed install.
   * The LEADING DOT is load-bearing: the API turns this into the wildcard
   * `*.deployer.localhost`, which matches `setup.deployer.localhost` while
   * REJECTING the bare `deployer.localhost` (a host this platform does not
   * serve). Dropping it would let `*` match the empty label and admit it.
   *
   * Derived from `DEPLOYER_PREFIX` rather than read from the environment so it
   * cannot disagree with the `api`/`web`/`setup` origins derived by
   * `publicOrigin` — one scheme, one place.
   */
  private authBaseDomain(prefix: string): string {
    return prefix === "" ? ".deployer.localhost" : `.${prefix}.deployer.localhost`;
  }

  /**
   * The managed web app's address INSIDE the platform network.
   *
   * The swarm service name, which is also its DNS name on the overlay — the
   * same value `ManagedWebSupervisorService` names its service
   * (`MANAGED_WEB_CONTAINER_BASE_NAME`, per-prefix `-<prefix>` appended), so the
   * two cannot drift. The web app listens on its own port, not the API's.
   */
  private managedWebServiceUrl(): string {
    const prefix = this.env.get("DEPLOYER_PREFIX");
    const name = prefix === "" ? "deployer-managed-web" : `deployer-managed-web-${prefix}`;
    return `http://${name}:3000`;
  }

  /**
   * Volume holding the shared SQLite file.
   *
   * Read from the environment because compose names volumes with its project
   * prefix, which this process cannot guess. The default mirrors the prod compose
   * file, so an install that does not set it is unchanged.
   */
  private localDbVolumeName(): string {
    return this.env.get("NODE_LOCAL_DB_VOLUME");
  }

  /**
   * The network the API service joins — the platform OVERLAY, not the bridge.
   *
   * ── WHY THE OVERLAY AND NOT `deployer-platform` ──────────────────────────
   * A swarm service's name resolves ONLY on a swarm-scoped network. Attaching it
   * to the compose BRIDGE (`deployer-platform`) creates the service but leaves
   * its DNS name unroutable, so every forward from setup failed with
   *
   *   Upstream http://deployer-api:3005/setup/stream unreachable:
   *   getaddrinfo ENOTFOUND deployer-api
   *
   * — the trigger was never delivered, the API never provisioned, and the
   * handover stalled until it timed out.
   *
   * The overlay is the swarm-scoped counterpart of that bridge, and the same
   * network the API's own supervisors wire compose-managed containers into, so
   * setup and the scheduled API share ONE DNS namespace.
   *
   * Derived from the shared helpers rather than hardcoded: `platformNetworkName`
   * is the single source of truth for the base name, and
   * `platformOverlayForPrefix` applies the `-overlay` suffix and the tenant
   * prefix exactly as the API's runtime does — so the two cannot drift.
   */
  private platformNetworkName(): string {
    return platformOverlayForPrefix(this.env.get("DEPLOYER_PREFIX"));
  }

  /**
   * Attach THIS container to the platform overlay.
   *
   * ── WHY SETUP MUST JOIN THE NETWORK IT JUST CREATED ─────────────────────
   * Scheduling the API is not enough to be able to CALL it: a swarm service's
   * name resolves only on a swarm-scoped network. A setup container on the
   * compose bridge alone therefore cannot resolve `deployer-api` even while the
   * service runs and the ingress routes to it — the one process that must hand
   * over is the one that cannot reach it.
   *
   * ── WHY HERE AND NOT IN COMPOSE ─────────────────────────────────────────
   * The overlay does not exist until this code creates it, so declaring it in
   * compose would require the network to be present before starting the very
   * container that makes it. Connecting self at runtime inverts that ordering
   * correctly.
   *
   * Mirrors `TraefikSupervisorService.connectSelfToOverlay` — the same
   * bridge-head join the API performs, so setup and the API end up on the
   * overlay by the same route. `HOSTNAME` is the container's own ID, which is
   * what the connect API expects; the guard keeps this a no-op outside Docker
   * (where HOSTNAME is a hostname, not an ID).
   */
  private async connectSelfToOverlay(overlay: string): Promise<void> {
    const selfId = process.env.HOSTNAME;
    if (selfId === undefined || !/^[0-9a-f]{12,64}$/.test(selfId)) {
      this.logger.warn(
        `Cannot attach setup to ${overlay}: HOSTNAME is not a container ID (running outside Docker?)`,
      );
      return;
    }

    // Not fatal on failure: the join is what lets setup TALK to the API, and
    // refusing to schedule the service over a reachability problem would turn a
    // recoverable misconfiguration into a total onboarding failure. A retry
    // re-attempts it, and "already connected" is the normal outcome then.
    await this.docker
      .getDockerClient()
      .getNetwork(overlay)
      .connect({ Container: selfId })
      .then(() => {
        this.logger.log(`Connected setup (${selfId.slice(0, 12)}) to the platform overlay ${overlay}`);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/already exists|already connected/i.test(message)) {
          this.logger.log(`Setup is already attached to ${overlay}`);
          return;
        }
        this.logger.warn(`Could not attach setup to ${overlay}: ${message}`);
      });
  }
}

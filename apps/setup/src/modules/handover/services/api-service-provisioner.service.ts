import { Injectable, Logger } from "@nestjs/common";
import { DockerService } from "@repo/nest-docker/services/docker.service";

import { EnvService } from "@/config/env/env.module";
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

    this.logger.log(`Creating API swarm service "${name}" from image ${image} (${String(replicas)} replica(s))`);

    await this.docker.createSwarmService({
      Name: name,
      // Replicated rather than global: the API is a stateless HTTP server behind
      // Traefik, so the operator chooses the count. GLOBAL would schedule one
      // task per node, which on a large fleet is not what "API_REPLICAS" means.
      Mode: { Replicated: { Replicas: replicas } },
      TaskTemplate: {
        ContainerSpec: {
          Image: image,
          Env: this.serviceEnvironment(port),
          // The SAME volume the setup container mounts. `node_config` holds the
          // swarm participation decision and the database URL setup already
          // wrote, and the API is the READER of that single writer's output
          // (plan §12.3) — so losing this mount would mean the API boots with no
          // idea a cluster exists.
          Mounts: [
            {
              Type: "volume",
              Source: this.localDbVolumeName(),
              Target: "/app/data",
            },
          ],
        },
        // Restart on failure, with backoff: a swarm task that fails during
        // boot (Postgres not yet reachable) must retry rather than wait for an
        // operator. Unlimited attempts would mask a permanently broken image,
        // so the count is bounded.
        RestartPolicy: {
          Condition: "on-failure",
          Delay: 10_000_000_000,
          MaxAttempts: 10,
        },
      },
      // vip, not dnsrr: Traefik dials one stable service address and the swarm
      // balances across replicas. `dnsrr` would return every task IP and push
      // balancing to Traefik, which then needs the task list to stay current.
      EndpointSpec: { Mode: "vip", Ports: [{ Protocol: "tcp", TargetPort: port, PublishedPort: port }] },
      // The service joins the platform overlay so Traefik resolves it by name.
      // `deployer_platform` is the network every platform service shares; the
      // alias is what the ingress backend URL uses.
      Networks: [{ Target: this.platformNetworkName(), Aliases: [name] }],
    });

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
   */
  private serviceEnvironment(port: number): string[] {
    const env = [`NODE_LOCAL_DB_PATH=/app/data/local.db`, `API_PORT=${String(port)}`];
    const prefix = this.env.get("DEPLOYER_PREFIX");
    if (prefix !== "") env.push(`DEPLOYER_PREFIX=${prefix}`);
    return env;
  }

  /** Volume holding the shared SQLite file. Mirrors compose's naming. */
  private localDbVolumeName(): string {
    const prefix = this.env.get("DEPLOYER_PREFIX");
    return prefix === "" ? "api_local_db_data_prod" : `api_local_db_data_${prefix}`;
  }

  /** The overlay every platform service joins. */
  private platformNetworkName(): string {
    return "deployer_platform";
  }
}

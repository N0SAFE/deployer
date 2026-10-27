import type { SwarmOverlayNetworkRequest } from "@deployer/contracts-entities";
import { Injectable, Logger } from "@nestjs/common";
import { DockerService } from "@deployer/nest-docker/services/docker.service";
import { platformOverlayForPrefix } from "@deployer/nest-docker/services/docker-supervisor-runtime";

import { EnvService } from "@/config/env/env.module";
import { DEFAULT_API_INTERNAL_PORT, type ApiBackend } from "../handover.types";
import { ServicesTierProvisioner } from "./services-tier-provisioner.service";

/**
 * Resolves — and in prod, CREATES — the API that onboarding hands over to.
 *
 * ── THE ONE TOPOLOGY ─────────────────────────────────────────────────────────
 * The platform's API is the microservices tier: `svc-bff` is the public surface and the five
 * `svc-*` services sit behind it (decision recorded in `docs/qa/api/topology.md`). There
 * is no monolith service and no second BFF shape to choose between.
 *
 * ── THE ONE BEHAVIOURAL DIFFERENCE BETWEEN dev AND prod ──────────────────────
 *
 *   dev   compose owns the tier. The BFF already runs, at a stable DNS name, and setup
 *         merely has to point the ingress at it. Nothing is created.
 *   prod  nothing runs the tier yet. Setup SCHEDULES it as swarm services from prebuilt images
 *         (`ServicesTierProvisioner`), then hands over to the BFF's DNS name.
 *
 * One flag (`SETUP_MODE`), two paths, same ending.
 *
 * ── WHY SETUP CREATES IT AND DOES NOT BUILD IT ──────────────────────────────
 * The images already exist: locally they were produced by the compose `build-svc-*` services, in
 * a real deployment they come from a registry. Building again would be a second source of truth
 * for "what is the API". Setup's job is to SCHEDULE the tags it is given.
 *
 * ── WHY SWARM SERVICES, RATHER THAN PLAIN CONTAINERS ────────────────────────
 * The cluster exists by this point, and `docker run` on a swarm node produces a container the
 * engine does not manage — no restart policy across nodes, no `service ls` visibility, no
 * placement. Scheduling services is what makes the API part of the cluster the operator just built.
 */
@Injectable()
export class ApiServiceProvisioner {
  private readonly logger = new Logger(ApiServiceProvisioner.name);

  /**
   * How long to keep retrying the connect of THIS container to the overlay.
   *
   * The engine's own join budget is ~20s and it is spent building the network
   * sandbox on a freshly created overlay, so one attempt can legitimately time
   * out while the next succeeds. Sized to ride out that settling window without
   * holding the handover open on a genuinely dead network.
   */
  private static readonly ATTACH_TIMEOUT_MS = 60_000;

  /**
   * Consecutive datapath failures that prove the VXLAN is poisoned rather than
   * still settling. One timeout is the engine's normal first-join hiccup; two in a
   * row on the same VNI is not.
   */
  private static readonly DATAPATH_FAILURES_BEFORE_REPAIR = 2;

  /** Overlay rebuilds on fresh VNIs before giving up. */
  private static readonly MAX_OVERLAY_REPAIRS = 3;

  /** Spacing between overlay-attach attempts. */
  private static readonly ATTACH_POLL_MS = 3_000;

  constructor(
    private readonly env: EnvService,
    private readonly docker: DockerService,
    private readonly tier: ServicesTierProvisioner,
  ) {}

  /**
   * The BFF's swarm service name, matching `ServicesTierProvisioner`.
   *
   * Derived the same way (`svc-<name>[-<prefix>]`) so the backend this hands over
   * to and the service the tier created cannot drift — a mismatch points
   * `api.<host>` at a name nothing answers on.
   */
  private tierBffName(): string {
    const prefix = this.env.get("DEPLOYER_PREFIX");
    return prefix === "" ? "svc-bff" : `svc-bff-${prefix}`;
  }

  /** The BFF's port inside the platform network. */
  apiPort(): number {
    return this.env.get("SETUP_API_PORT") ?? DEFAULT_API_INTERNAL_PORT;
  }

  /**
   * Resolve the handover target, scheduling the tier first in prod.
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
        throw new Error("SETUP_MODE=dev requires SETUP_API_URL (compose owns the BFF in dev)");
      }
      return {
        kind: "container",
        url: url.replace(/\/+$/, ""),
        detail: "compose-managed BFF (dev)",
      };
    }

    return await this.scheduleTier();
  }

  /**
   * Schedule the tier and return the BFF's DNS backend.
   *
   * IDEMPOTENT: existing services are converged, not recreated (`ServicesTierProvisioner`), so a
   * retried handover is not an outage.
   *
   * ── THE OVERLAY AND THIS CONTAINER'S ATTACHMENT COME FIRST ────────────────
   * Joining the overlay is also the probe for a poisoned VXLAN datapath, and an empty network is
   * the cheapest one to rebuild (see `connectSelfToOverlay`). Setup must join it anyway: a swarm
   * service's name resolves only on a swarm-scoped network, so a setup container left on the
   * compose bridge cannot call `svc-bff` even while it runs and the ingress routes to it. The
   * attach happens on the reuse path too — every re-run takes it, and a re-run is when an operator
   * retries.
   */
  private async scheduleTier(): Promise<ApiBackend> {
    const bffImage = this.env.get("DEPLOYER_BFF_IMAGE");
    if (bffImage === undefined || bffImage.length === 0) {
      throw new Error("SETUP_MODE=prod requires DEPLOYER_BFF_IMAGE (and the DEPLOYER_SVC_*_IMAGE tags): setup schedules the microservices tier");
    }

    const overlay = this.platformNetworkName();
    await this.docker.ensureOverlayNetwork(this.overlayRequest(overlay));
    await this.connectSelfToOverlay(overlay);

    const apps = await this.tier.ensureTier();

    const bff = apps.find((app) => app.name === this.tierBffName());
    if (bff === undefined) {
      throw new Error("The microservices tier was scheduled without a BFF — refusing to hand over");
    }
    this.logger.log(`Microservices tier ready (${String(apps.length)} apps) — handing over to ${bff.name}`);
    return this.backendFor(bff.name, bff.image, "microservices tier on the platform overlay");
  }

  /**
   * The HTTP status the engine attached to an error, when it carried one.
   *
   * Dockerode surfaces the engine's response code on `statusCode`, and the message
   * also embeds it (`(HTTP code 409) …`). Reading the STRUCTURED value is what lets
   * a conflict be recognised without depending on the engine's wording — see the
   * `already attached` note in `connectSelfToOverlay`.
   */
  private statusCodeOf(error: unknown): number | null {
    if (typeof error !== "object" || error === null) return null;
    const code = (error as { statusCode?: unknown }).statusCode;
    return typeof code === "number" ? code : null;
  }

  private backendFor(name: string, image: string, detail: string): ApiBackend {
    return {
      kind: "swarm",
      url: `http://${name}:${String(this.apiPort())}`,
      serviceName: name,
      detail: `${detail} (${image})`,
    };
  }


  /**
   * The network the API service joins — the platform OVERLAY, not the bridge.
   *
   * ── WHY THE OVERLAY AND NOT `deployer-platform` ──────────────────────────
   * A swarm service's name resolves ONLY on a swarm-scoped network. Attaching it
   * to the compose BRIDGE (`deployer-platform`) creates the service but leaves
   * its DNS name unroutable, so every forward from setup failed with
   *
   *   Upstream http://svc-bff:3005/setup/stream unreachable:
   *   getaddrinfo ENOTFOUND svc-bff
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
  private overlayRequest(name: string): SwarmOverlayNetworkRequest {
    return {
      name,
      driver: "overlay",
      attachable: true,
      ingress: false,
      enableIpv6: false,
      labels: { "deployer.managed": "true", "deployer.platform": "true" },
    };
  }

  private platformNetworkName(): string {
    return platformOverlayForPrefix(this.env.get("DEPLOYER_PREFIX"));
  }

  /**
   * Attach THIS container to the platform overlay.
   *
   * ── WHY SETUP MUST JOIN THE NETWORK IT JUST CREATED ─────────────────────
   * Scheduling the API is not enough to be able to CALL it: a swarm service's
   * name resolves only on a swarm-scoped network. A setup container on the
   * compose bridge alone therefore cannot resolve `svc-bff` even while the
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
   *
   * ── WHY THE ATTACH IS RETRIED ────────────────────────────────────────────
   * A freshly created overlay refuses an endpoint join while the engine is still
   * building its bridge + VXLAN inside the network sandbox:
   *
   *   attaching to network failed ... context deadline exceeded
   *
   * Observed on a real run, where the SAME attach succeeded seconds later — the
   * deadline is the engine's own 20s budget being consumed by the setup work,
   * not a permanent refusal. Giving up on the first attempt turned a transient
   * settling window into a total handover failure, so the connect is retried
   * until it either succeeds or the budget below is spent.
   */
  private async connectSelfToOverlay(overlay: string): Promise<void> {
    const selfId = process.env.HOSTNAME;
    if (selfId === undefined || !/^[0-9a-f]{12,64}$/.test(selfId)) {
      this.logger.warn(
        `Cannot attach setup to ${overlay}: HOSTNAME is not a container ID (running outside Docker?)`,
      );
      return;
    }

    let deadline = Date.now() + ApiServiceProvisioner.ATTACH_TIMEOUT_MS;
    let lastMessage = "the engine refused the join without an error message";
    let datapathFailures = 0;
    let repairs = 0;
    let poisonedVnis: number[] = [];

    while (Date.now() < deadline) {
      try {
        await this.docker.getDockerClient().getNetwork(overlay).connect({ Container: selfId });
        this.logger.log(`Connected setup (${selfId.slice(0, 12)}) to the platform overlay ${overlay}`);
        return;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // ── ALREADY ATTACHED IS SUCCESS, AND THE ENGINE WORDS IT THREE WAYS ───
        // This matched only `already exists|already connected`. The engine's actual
        // message for "this container is on that network" is
        //
        //   (HTTP code 409) unexpected - nextjs-nestjs-setup-dev is already
        //   attached to network deployer-platform-overlay
        //
        // — which neither alternative matches. So a container that was ALREADY
        // correctly wired was treated as a failure, retried for the full 60s
        // budget, and then failed the handover:
        //
        //   ERROR [HandoverOrchestratorService] Handover failed: Cannot reach the
        //   platform overlay deployer-platform-overlay — this container could not
        //   be attached within 60s. Engine said: (HTTP code 409) … is already
        //   attached to network deployer-platform-overlay
        //
        // The most likely case therefore failed hardest: the attach had already
        // SUCCEEDED (on an earlier attempt, or in a previous run because the
        // container survived a `docker compose up`), and the retry loop could
        // never accept its own success.
        //
        // `409` is the engine's conflict code for exactly this, so it is checked
        // STRUCTURALLY as well as by message — an engine wording change must not
        // turn a success back into a timeout.
        if (this.statusCodeOf(error) === 409 || /already (exists|connected|attached)/i.test(message)) {
          this.logger.log(`Setup is already attached to ${overlay}`);
          return;
        }

        // ── POISONED DATA PATH: REBUILD THE OVERLAY ON ANOTHER VNI ──────────
        // The engine can hold a VXLAN id whose device it can never create again:
        //
        //   subnet sandbox join failed for "10.0.1.0/24":
        //   error creating vxlan interface: file exists
        //
        // Nothing the engine reports at inspect time shows it; the only symptom is
        // every join on that network timing out (this container's and every swarm
        // task's), and only a daemon restart clears the stale device. The VNI is
        // the poisoned part, so the repair is to recreate the network on a
        // different one. Services holding the network are removed by the rebuild
        // and re-created by the caller, which is why the attach runs BEFORE the
        // tier or the API is scheduled on a fresh network.
        //
        // Triggered by consecutive failures, not the first, so a settling network
        // never costs anyone their services; bounded, so a genuinely dead engine
        // ends in an accurate error instead of a rebuild loop.
        if (/vxlan|file exists|context deadline exceeded/i.test(message)) {
          datapathFailures += 1;
          if (
            datapathFailures >= ApiServiceProvisioner.DATAPATH_FAILURES_BEFORE_REPAIR &&
            repairs < ApiServiceProvisioner.MAX_OVERLAY_REPAIRS
          ) {
            repairs += 1;
            datapathFailures = 0;
            this.logger.warn(
              `Overlay ${overlay} has an unusable data path (${message}) — rebuilding it on a fresh VXLAN id (repair ${String(repairs)}/${String(ApiServiceProvisioner.MAX_OVERLAY_REPAIRS)})`,
            );
            const rebuilt = await this.docker.recreateOverlayNetwork(this.overlayRequest(overlay), {
              detachContainerIds: [selfId],
              avoidVxlanIds: poisonedVnis,
            });
            poisonedVnis = rebuilt.avoidedVxlanIds;
            deadline = Date.now() + ApiServiceProvisioner.ATTACH_TIMEOUT_MS;
            continue;
          }
        } else {
          datapathFailures = 0;
        }

        lastMessage = message;
        this.logger.log(
          `Overlay ${overlay} not ready for this container yet — retrying (engine said: ${message})`,
        );
        await new Promise((resolve) => setTimeout(resolve, ApiServiceProvisioner.ATTACH_POLL_MS));
      }
    }

    // ── EXHAUSTED, WHICH IS FATAL ───────────────────────────────────────────
    // Setup being off the overlay is not a local problem: a swarm service's name
    // resolves only on a swarm-scoped network, so every `svc-bff` lookup
    // fails and the readiness pipeline polls a name that cannot answer until its
    // 300s budget expires. The operator then sees a TIMEOUT that names neither
    // the overlay nor the cause. Throwing surfaces the engine's own words in
    // seconds, at the step that actually failed.
    throw new Error(
      `Cannot reach the platform overlay ${overlay} — this container could not be attached within ` +
        `${String(ApiServiceProvisioner.ATTACH_TIMEOUT_MS / 1000)}s. Engine said: ${lastMessage}`,
    );
  }
}

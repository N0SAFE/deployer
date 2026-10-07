import { Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from "@nestjs/common";
import { request as httpRequest } from "node:http";
import { Socket } from "node:net";
import { DockerService } from "@repo/nest-docker/services/docker.service";
import { platformNetworkName } from "@repo/nest-docker/services/docker-supervisor-runtime";

import { EnvService } from "@/config/env/env.module";

/**
 * The BOOTSTRAP ingress — Traefik as a plain container, supervised by setup.
 *
 * ── THE DEADLOCK THIS EXISTS TO BREAK ───────────────────────────────────────
 * This app publishes no ports and is reachable ONLY through Traefik. Traefik is
 * normally supervised by the API — but the API starts only after this app opens
 * the gate, and the gate opens only when an operator completes the wizard in a
 * browser. With no ingress, that chain has no entry point:
 *
 *   setup serves the wizard on :3016, reachable only via Traefik
 *     → nothing runs Traefik (compose manages none in dev-supervised / prod)
 *     → the wizard cannot be loaded
 *     → /setup/health never turns 200
 *     → the API never starts
 *     → and the API is what supervises Traefik.   ✗
 *
 * So the ingress runs in TWO incarnations (plan §9), one per side of the gate:
 *
 *   ┌──────────────┬───────────────────────┬────────────────────────────────┐
 *   │              │ State A — BOOTSTRAP   │ State B — SWARM                │
 *   ├──────────────┼───────────────────────┼────────────────────────────────┤
 *   │ Runtime      │ plain container       │ swarm GLOBAL service           │
 *   │ Supervised by│ THIS service (setup)  │ TraefikSupervisorService (API) │
 *   │ Name         │ deployer-traefik      │ deployer-traefik      (same)   │
 *   │ Entry port   │ DEPLOYER_TRAEFIK_...  │ the same port         (same)   │
 *   │ Providers    │ file (+ docker)       │ file (+ docker + swarm)        │
 *   └──────────────┴───────────────────────┴────────────────────────────────┘
 *
 * ── WHY IT IS NOT `swarm-global` FROM THE START ─────────────────────────────
 * A swarm service cannot exist before the swarm does, and founding the swarm is
 * what the wizard decides (create vs join). Scheduling the ingress as a service
 * would make the ingress depend on the very thing it must front — the same
 * cycle in a different form.
 *
 * ── WHY THE NAME AND PORT ARE SHARED WITH THE API'S SUPERVISOR ──────────────
 * The promotion must not move a hostname or a port. Both incarnations resolve
 * the same `deployer-traefik` name and the same
 * `DEPLOYER_TRAEFIK_HTTP_PORT`, so the swap changes only HOW the container
 * runs. `releaseEntryPort()` does the handover of the port itself.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 * It does not write route config. `IngressHandoverService` owns
 * `dynamic-setup.yml` / `dynamic-api.yml`, and both processes reach Traefik
 * through the shared config volume rather than through this service. This file
 * is only the PROCESS.
 */
@Injectable()
export class BootstrapIngressService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapIngressService.name);

  /**
   * Container name Traefik must have.
   *
   * `deployer-traefik` — the SAME name the API's supervisor uses
   * (`platformTraefikContainerName`). That is what makes the promotion a
   * restart rather than a rename, and it is why the constant is repeated here
   * instead of imported: importing it would drag the API's platform-ingress
   * policy into setup, and the value is part of the contract between the two
   * incarnations rather than an implementation detail of either.
   */
  static readonly CONTAINER_NAME = "deployer-traefik";

  /**
   * The PROMOTED ingress, addressed on the platform overlay.
   *
   * The swarm service keeps the bootstrap container's name, so this is the same
   * `deployer-traefik` string — but it is reached as a NETWORK NAME rather than
   * a container name, which is what makes it a valid probe target from setup
   * once setup has joined the overlay. Port 80 is Traefik's `web` entrypoint
   * INSIDE the container, independent of the host port it may publish.
   */
  private static readonly SWARM_SERVICE_NAME = "deployer-traefik";
  private static readonly SWARM_SERVICE_PORT = 80;

  /** Where the file provider reads generated routes inside the container. */
  private static readonly CONFIG_MOUNT = "/config";

  /**
   * How long to wait for the swarm ingress to take over the entry port.
   *
   * Generous because this covers a full SERVICE SCHEDULING round trip: the
   * scheduler must place the task, pull/verify the image, create the container
   * and start it. Thirty seconds was enough on a warm node and not on a restart
   * (measured), and a timeout here has a costly failure mode — it restores the
   * bootstrap container, which then fights the swarm task for the port forever.
   */
  private static readonly PROMOTION_TIMEOUT_MS = 90_000;

  /** How long to wait for the ingress to answer before reporting failure. */
  private static readonly READY_TIMEOUT_MS = 20_000;
  private static readonly READY_POLL_MS = 500;

  /**
   * How long to wait for the PROMOTED ingress to answer on the entry port.
   *
   * Separate from `READY_TIMEOUT_MS`, which bounds a container start. This one
   * bounds a config-volume load plus router publication on a freshly scheduled
   * swarm task, so it is deliberately longer — and it only ever runs after the
   * promotion already succeeded, which is why a generous budget costs nothing.
   */
  private static readonly SERVE_TIMEOUT_MS = 60_000;

  constructor(
    private readonly docker: DockerService,
    private readonly env: EnvService,
  ) {}

  /**
   * Start the ingress at boot, BEFORE anything tries to route through it.
   *
   * ORDER MATTERS: `IngressHandoverService` publishes the wizard's route in its
   * own `onApplicationBootstrap`, and Traefik's file provider reads that
   * directory on start plus every change. Starting the process first means the
   * route is picked up on the provider's initial scan instead of waiting for a
   * watch event — one fewer moving part during the only phase whose purpose is
   * to be reachable.
   *
   * NEVER THROWS. A node that cannot start its ingress must still serve the
   * wizard on its internal port and report the reason, because the wizard is the
   * ONLY surface that can tell an operator what is wrong. Failing the boot here
   * would turn a diagnosable ingress problem into a crash-loop with no output.
   */
  async onApplicationBootstrap(): Promise<void> {
    // The deployment already runs an ingress (plain `dev`: compose publishes its
    // own Traefik on the same host port). Starting a second one cannot work — the
    // port is exclusively bound — so this app only ROUTES through the existing
    // one, which it already does by writing `dynamic-setup.yml` into the shared
    // config volume.
    if (this.isExternallyManaged()) {
      this.logger.log(
        "Deployment owns the ingress (MANAGED_TRAEFIK_ENABLED=true) — bootstrap ingress skipped; " +
          "this app routes through the existing Traefik via the shared config volume",
      );
      return;
    }

    try {
      await this.ensureRunning();
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Could not start the bootstrap ingress — reach this app on its internal port ` +
          `(:${String(this.env.get("SETUP_APP_PORT"))}) and check the engine. Cause: ${detail}`,
      );
    }
  }

  /** True when compose/operator owns Traefik, so this app must not run one. */
  isExternallyManaged(): boolean {
    return this.env.get("MANAGED_TRAEFIK_ENABLED");
  }

  /**
   * Converge the ingress container to "running and bound to the entry port".
   *
   * IDEMPOTENT, and that is required rather than nice: `docker restart` and
   * compose recreating this container both re-run boot, and the ingress is
   * frequently ALREADY running (a plain `docker compose up` after a first run
   * leaves it up). Re-creating it blindly would drop the entry port and every
   * live connection on a container that was already correct.
   *
   * A running container with the RIGHT port and mounts is left untouched; a
   * stopped one is started; a missing one is created; and one whose
   * configuration drifted (port or image changed in `.env`) is recreated —
   * which is what makes changing `DEPLOYER_TRAEFIK_HTTP_PORT` actually take
   * effect instead of silently doing nothing.
   */
  async ensureRunning(): Promise<void> {
    // Already converged? Nothing to do — see the idempotency note above.
    const existing = await this.inspect();
    if (existing !== null) {
      if (existing.running && this.matchesDesired(existing)) {
        this.logger.log(
          `Bootstrap ingress already running (${BootstrapIngressService.CONTAINER_NAME} → :${String(this.entryPort())})`,
        );
        return;
      }
      // Stopped, or configured differently — recreate rather than patch. A
      // container's mounts and port bindings are FIXED at creation, so
      // "recreate" is the only way to change them, and starting a stopped
      // container from a previous configuration would converge to the wrong
      // state (a stale port) while appearing to succeed.
      this.logger.log(
        `Recreating bootstrap ingress — ${existing.running ? "configuration changed" : "container was stopped"}`,
      );
      await this.remove();
    }

    await this.docker.pullImage(this.image()).catch((error: unknown) => {
      // A pull failure is not fatal when the image is already local (offline
      // node, pre-pulled image): `createContainer` uses the local tag. Only
      // report it, and let creation produce the real error if it is missing too.
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not pull ${this.image()} (using the local tag if present): ${detail}`);
    });

    await this.create();
    await this.verifyReachable();

    this.logger.log(
      `Bootstrap ingress running (${BootstrapIngressService.CONTAINER_NAME} → :${String(this.entryPort())}) — ` +
        `${this.ingressStateNote()}`,
    );
  }

  /**
   * Stop and remove the bootstrap container, releasing the entry port.
   *
   * ── WHY THIS EXISTS: THE PORT IS EXCLUSIVELY BOUND ──────────────────────────
   * The entry port is a HOST port. Only one process can hold it, so the
   * container incarnation MUST release it before the swarm incarnation can bind
   * it. The API's supervisor promotes Traefik after the gate opens, and if this
   * container still held :80 that promotion would fail with
   * "address already in use" — leaving the platform with an ingress it cannot
   * promote and an error that names the port rather than the cause.
   *
   * ── WHO CALLS THIS, AND WHEN ────────────────────────────────────────────────
   * `IngressHandoverService` calls it at the START of the handover, right after
   * retargeting `dynamic-api.yml`. By then:
   *
   *   - the API is already green (the handover polls `/health/ready` first), so
   *     the swap cannot point `api.<host>` at a process that is not serving;
   *   - the wizard's SSE stream has already delivered its terminal event, and
   *     that stream terminates at THIS app, not through the entry port;
   *   - `setup.<host>` stays answerable, because both the route and — see below
   *     — the ingress survive the swap.
   *
   * ── WHY THE INGRESS IS RE-CREATED, NOT LEFT ABSENT ──────────────────────────
   * Removing it frees the port for the swarm service, but the swarm service
   * takes seconds to schedule and a GLOBAL task to start. If nothing held the
   * port in between, `setup.<host>` would 404 for that whole window — the exact
   * "never let a URL change owner by disappearing" rule (plan §9.2). So after
   * releasing the port this method waits for the swarm ingress to take it, and
   * restores the container if it never does. A failed handover stays retryable
   * instead of stranding the operator with no ingress at all.
   *
   * Returns true when the port was handed to the swarm ingress.
   */
  async releaseEntryPort(): Promise<boolean> {
    // Nothing to release when this app never ran an ingress: the deployment owns
    // it, and the API's supervisor is likewise in `managed` mode, so no promoter
    // is waiting for the port.
    if (this.isExternallyManaged()) {
      this.logger.log("Deployment owns the ingress — no entry port to release");
      return true;
    }

    const name = BootstrapIngressService.CONTAINER_NAME;
    const existing = await this.inspect();
    if (existing === null) {
      // Nothing holds the port from our side — the swarm service may already
      // own it (a previous handover, or an operator who promoted it by hand).
      this.logger.log("Bootstrap ingress absent — nothing to release");
      return true;
    }

    this.logger.log(`Releasing the entry port — stopping ${name} so the swarm ingress can bind it`);
    await this.remove();

    if (await this.waitForSwarmIngressRunning()) return true;

    // The swarm service genuinely never ran. Restore the bootstrap container so
    // the platform stays reachable, then let the next handover retry.
    //
    // The restore is the TIE-BREAK, and its failure is the answer: if the port
    // is already allocated, SOMETHING holds it, and the only other claimant is
    // the swarm ingress — so the promotion did succeed after all. Observed on a
    // real run, where setup reported a failed handover while the platform was
    // fully up:
    //
    //   [BootstrapIngressService] The swarm ingress did not claim the entry port...
    //   [HandoverOrchestratorService] Handover failed: (HTTP code 500) ...
    //     Bind for 0.0.0.0:80 failed: port is already allocated
    //
    // So the error is READ rather than propagated: "port is already allocated"
    // means the promotion succeeded and the bootstrap container must stay down.
    // Any OTHER failure is a genuine problem and still propagates.
    this.logger.warn(
      "The swarm ingress did not claim the entry port in time — restoring the bootstrap container " +
        "so the platform stays reachable, then retrying on the next handover",
    );
    try {
      await this.create();
      return false;
    } catch (error: unknown) {
      if (this.isPortTakenError(error)) {
        this.logger.log(
          "Bootstrap ingress could not be restored because the entry port is taken — " +
            "the swarm ingress owns it, so the handover succeeded",
        );
        return true;
      }
      throw error;
    }
  }

  /**
   * Wait until the ENTRY POINT itself answers — i.e. the promoted ingress serves
   * through the host port it just took over.
   *
   * ── WHY THIS IS SEPARATE FROM THE PROMOTION WAIT ────────────────────────
   * `waitForSwarmIngressRunning()` establishes that a TASK is running. That is
   * necessary but not sufficient for the operator: the task still has to load the
   * config volume and publish its routers before `:80` returns anything, and a
   * request in that window fails at the connection level. This is the check that
   * covers the gap — and it is the one that matters, because it tests exactly
   * what the operator's browser will do next.
   *
   * Returns false when nothing answers within the budget, which the caller turns
   * into a retryable failure rather than a success it cannot back up.
   */
  /**
   * Wait until the PROMOTED ingress actually ROUTES, not merely binds.
   *
   * ── WHY A TCP CONNECT IS NOT ENOUGH ──────────────────────────────────────
   * The swarm Traefik publishes its entrypoint within a second of starting, long
   * before it has loaded the config volume and built its router table. A socket
   * connect succeeds through that entire window, so a port-only check reports
   * "serving" while every request still gets Traefik's own
   *
   *   404 page not found
   *
   * — which is what the operator saw as a red "Failed to fetch" on the last
   * wizard step: the stream had already reported success, the browser followed
   * the Continue target, and the router table was not there yet.
   *
   * So the verdict is the ROUTED RESPONSE. `api.<host>` is the right subject
   * because its router is the one that must be live for the handover to be
   * meaningful, and it is already published by the time this runs.
   *
   * Returns false when no routed answer arrives within the budget, which the
   * caller turns into a RETRYABLE failure rather than a success it cannot back up.
   */
  async waitForEntryPointToServe(hostname: string): Promise<boolean> {
    const deadline = Date.now() + BootstrapIngressService.SERVE_TIMEOUT_MS;
    let lastReason = "the entry port never accepted a connection";

    while (Date.now() < deadline) {
      const attempt = await this.probeRoutedThroughEntryPort(hostname);
      if (attempt.ok) {
        this.logger.log(`Cluster ingress is routing ${hostname} (${attempt.reason})`);
        return true;
      }
      lastReason = attempt.reason;
      await new Promise((resolve) => setTimeout(resolve, BootstrapIngressService.READY_POLL_MS));
    }

    this.logger.warn(
      `The cluster ingress did not route ${hostname} within ` +
        `${String(BootstrapIngressService.SERVE_TIMEOUT_MS / 1000)}s of the handover — ${lastReason}`,
    );
    return false;
  }

  /**
   * One HTTP request for `hostname` through the promoted ingress.
   *
   * ── WHY THERE ARE TWO CANDIDATES, OVERLAY FIRST ─────────────────────────
   * The question is "is the SWARM ingress routing?", and there are two ways to
   * reach it from here. Only one of them works for every provider:
   *
   *   OVERLAY (`deployer-traefik:80`) — the service name on the platform
   *     network. This reaches the ingress whatever it binds on the HOST, so it
   *     is provider-independent, and it is also the path real traffic takes
   *     once a connector or the mesh fronts it.
   *
   *   ENTRY PORT via `host.docker.internal` — the host-published port. This is
   *     the operator's actual path, but it only answers when the ingress binds
   *     an interface reachable from the host gateway. Under the `local`
   *     provider the host port is bound on 127.0.0.1 ONLY (deliberately — that
   *     is what keeps a fresh install off the network), so a probe from inside
   *     a container gets `ECONNREFUSED 172.17.0.1:80` while the ingress is
   *     perfectly healthy. Treating that as "not serving" failed the handover
   *     and left the platform reported broken when it was up.
   *
   * So the overlay is tried first and the entry port is the fallback. The Host
   * header is always sent explicitly because the overlay is reached by service
   * name and the entry port by IP — without it Traefik would have no router to
   * match and every probe would look like a failure.
   */
  private async probeRoutedThroughEntryPort(hostname: string): Promise<{ ok: boolean; reason: string }> {
    // Candidate 1: the swarm service on the overlay (provider-independent).
    const viaOverlay = await this.probeIngress(
      BootstrapIngressService.SWARM_SERVICE_NAME,
      BootstrapIngressService.SWARM_SERVICE_PORT,
      hostname,
    );
    if (viaOverlay.ok) return viaOverlay;

    // Candidate 2: the host-published entry port (the operator's path).
    const viaEntryPort = await this.probeIngress(this.hostGateway(), this.entryPort(), hostname);
    if (viaEntryPort.ok) return viaEntryPort;

    // Report the ENTRY-PORT reason: it is the one the operator's browser will
    // hit, so it is the honest description of why the platform is unreachable
    // if BOTH failed.
    return viaEntryPort;
  }

  /**
   * One routed request against a specific `host:port`.
   *
   * Traefik's own "no router" answer is a PLAIN-TEXT 404. That is the specific
   * thing being waited out, so it must not be mistaken for a routed response
   * just because it is not a 5xx.
   */
  private async probeIngress(
    host: string,
    port: number,
    hostname: string,
  ): Promise<{ ok: boolean; reason: string }> {
    return await new Promise<{ ok: boolean; reason: string }>((resolve) => {
      let settled = false;
      const finish = (result: { ok: boolean; reason: string }): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const request = httpRequest(
        {
          host,
          port,
          path: "/health/ready",
          method: "GET",
          headers: { host: hostname },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const contentType = String(response.headers["content-type"] ?? "");
          response.resume();

          if (status === 404 && contentType.includes("text/plain")) {
            finish({ ok: false, reason: "the ingress has no router for the API yet" });
            return;
          }
          if (status >= 500) {
            finish({ ok: false, reason: `the API backend answered ${String(status)}` });
            return;
          }
          finish({ ok: true, reason: `HTTP ${String(status)} via ${host}:${String(port)}` });
        },
      );

      request.setTimeout(5_000, () => {
        request.destroy();
        finish({ ok: false, reason: `the ingress did not answer within 5000ms (${host}:${String(port)})` });
      });
      request.on("error", (error: Error) => {
        finish({ ok: false, reason: `not reachable yet (${error.message} via ${host}:${String(port)})` });
      });
      request.end();
    });
  }

  /**
   * Wait until the SWARM ingress service has a running task on this node.
   *
   * ── WHY THIS REPLACES A PORT POLL ────────────────────────────────────────
   * The release used to wait for the host port to ACCEPT a connection. That ask
   * the wrong question: on a restart the port is taken by the bootstrap container
   * itself right up until `remove()` finishes, and afterwards by whichever
   * process wins the race to bind. Determining "did the promotion work?" from
   * port ownership meant the answer depended on WHO bound first:
   *
   *   remove()  ->  swarm task starts, tries to bind :80
   *                  -> fails while the port is still transitioning
   *                  -> task exits, scheduler retries
   *   waitForPortTaken() polls, sees nothing, times out
   *   -> the bootstrap container is RESTORED
   *   -> now BOTH are trying to own :80, and the swarm task crash-loops forever
   *      with "Bind for 0.0.0.0:80 failed: port is already allocated"
   *
   * Observed exactly that, on a restart: `deployer-traefik` service at 0/0 with a
   * task failing every 5s, while a plain `deployer-traefik` container held the
   * port — neither able to win, so onboarding never completed.
   *
   * Asking the SERVICE whether it has a running task removes the race entirely:
   * the port is only ever contended for the window between `remove()` and the
   * task reaching `running`, and success no longer depends on a 30s budget being
   * enough for the scheduler.
   *
   * Returns false (so the caller restores the container) only when the service
   * genuinely has no running task within the budget — a real failure worth
   * surfacing, not a lost race.
   */
  private async waitForSwarmIngressRunning(): Promise<boolean> {
    const deadline = Date.now() + BootstrapIngressService.PROMOTION_TIMEOUT_MS;
    let lastDetail = "the swarm ingress service was never observed";

    while (Date.now() < deadline) {
      const state = await this.swarmIngressState();
      if (state.running) return true;
      lastDetail = state.detail;
      await new Promise((resolve) => setTimeout(resolve, BootstrapIngressService.READY_POLL_MS));
    }

    // Fall back to the port probe: a task can be `running` yet not yet bound, and
    // (rarer) the engine can report a stale task state. The port is the ground
    // truth about reachability, so it gets the final say.
    if (await this.portAnswers(1_000)) {
      this.logger.log("Swarm ingress answers on the entry port — promotion complete");
      return true;
    }

    this.logger.warn(`Swarm ingress not promoted: ${lastDetail}`);
    return false;
  }

  /** Whether the swarm ingress service has a task running on this node. */
  private async swarmIngressState(): Promise<{ running: boolean; detail: string }> {
    const serviceName = this.swarmServiceName();

    // The service is created by the API's supervisor AFTER the gate opens, and
    // this poll runs during the handover — so "not created yet" is the NORMAL
    // first answer, not a fault. Checking it explicitly keeps that out of the
    // task listing, which logs an ERROR for a 404 and would make every handover
    // look like it failed.
    try {
      await this.docker.inspectSwarmService(serviceName);
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        return { running: false, detail: `${serviceName} has not been created yet` };
      }
      const detail = error instanceof Error ? error.message : String(error);
      return { running: false, detail: `${serviceName} could not be inspected (${detail})` };
    }

    try {
      const tasks = await this.docker.listSwarmServiceTasks(serviceName);
      if (tasks.length === 0) {
        return { running: false, detail: `${serviceName} has no tasks scheduled` };
      }
      const running = tasks.filter((task) => task.Status.State === "running").length;
      if (running > 0) return { running: true, detail: `${serviceName} has ${String(running)} running task(s)` };

      // Surface the FIRST task error verbatim: the port-conflict text is what
      // makes this diagnosable, and it is the whole reason the promotion can
      // fail while the service "exists".
      const failing = tasks.find((task) => task.Status.Err !== undefined && task.Status.Err !== "");
      return {
        running: false,
        detail: failing === undefined
          ? `${serviceName} tasks are not running yet (${tasks.map((task) => task.Status.State).join(", ")})`
          : `${serviceName} task failed: ${failing.Status.Err}`,
      };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      return { running: false, detail: `${serviceName} could not be inspected (${detail})` };
    }
  }

  /** `deployer-traefik`, per prefix — the same name the API's supervisor uses. */
  private swarmServiceName(): string {
    const prefix = this.env.get("DEPLOYER_PREFIX");
    return prefix === "" ? BootstrapIngressService.CONTAINER_NAME : `${BootstrapIngressService.CONTAINER_NAME}-${prefix}`;
  }

  /**
   * Whether an engine error means "something already holds the entry port".
   *
   * Matched on the daemon's own wording. Docker reports this several ways
   * depending on which layer refuses, so all the known spellings are covered —
   * a miss here would turn a successful handover into a reported failure.
   */
  private isPortTakenError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes("port is already allocated") ||
      message.includes("address already in use") ||
      message.includes("failed to bind host port") ||
      message.includes("failed programming external connectivity")
    );
  }

  // ─── Desired state ────────────────────────────────────────────────────────

  /** The image both incarnations run. */
  private image(): string {
    return this.env.get("DEPLOYER_TRAEFIK_IMAGE");
  }

  /** The published entry port, shared with the API's supervisor. */
  private entryPort(): number {
    return this.env.get("DEPLOYER_TRAEFIK_HTTP_PORT");
  }

  /** Named volume carrying the generated dynamic config. */
  private configVolume(): string {
    return this.env.get("TRAEFIK_CONFIG_VOLUME");
  }

  /** Host socket path for the docker provider (container discovery). */
  private socketPath(): string {
    return this.env.get("DOCKER_HOST").replace("unix://", "");
  }

  /**
   * The bridge network Traefik must join to reach this app.
   *
   * `deployer-platform` is the SAME network compose attaches every app to, and
   * the one the API's supervisors converge onto. Joining it by NAME (rather than
   * creating a network) is what lets the ingress resolve the `setup` alias this
   * app is published under — the route Traefik is asked to serve points at
   * `http://setup:3016`, a docker-network name that means nothing otherwise.
   */
  private platformNetwork(): string {
    return platformNetworkName(this.env.get("DEPLOYER_PREFIX"));
  }

  /**
   * Provider flags for the BOOTSTRAP incarnation.
   *
   * Only `docker` + `file`: the swarm provider is deliberately omitted. It is
   * useless before a cluster exists, and enables nothing here — whereas the API's
   * incarnation adds it because by then there ARE services to route to. Keeping
   * this list minimal means the bootstrap ingress cannot half-work in a way that
   * depends on a cluster that is not there yet.
   *
   * The `file` provider is the load-bearing one: it is how a route written by
   * `IngressHandoverService` reaches Traefik without either process talking to
   * the other.
   */
  private command(): string[] {
    return [
      "--providers.docker=true",
      "--providers.docker.exposedbydefault=false",
      `--providers.file.directory=${BootstrapIngressService.CONFIG_MOUNT}`,
      "--providers.file.watch=true",
      "--entrypoints.web.address=:80",
    ];
  }

  /** Create (not start) the ingress container from the desired state. */
  private async create(): Promise<void> {
    const name = BootstrapIngressService.CONTAINER_NAME;
    this.logger.log(`Creating bootstrap ingress ${name} from ${this.image()}`);

    await this.docker.createContainer({
      name,
      Image: this.image(),
      Cmd: this.command(),
      // The ownership marker the API's supervisors already use, so cleanup and
      // inspection tooling sees ONE naming scheme across both incarnations —
      // and so the promoted swarm service is recognisably the same component.
      Labels: {
        "deployer.platform.role": "ingress",
        "deployer.managed": "true",
        "deployer.bootstrap": "true",
      },
      ExposedPorts: { "80/tcp": {} },
      HostConfig: {
        PortBindings: { "80/tcp": [{ HostPort: String(this.entryPort()) }] },
        // `unless-stopped`, matching every other platform service AND the
        // compose-managed ingress: the ingress must come back after a host
        // reboot, because nothing else can serve the wizard that would
        // otherwise be needed to fix it.
        RestartPolicy: { Name: "unless-stopped" },
        Binds: [
          // Dynamic config, shared with this app. READ-ONLY: the file provider
          // only reads, and a writable mount would let a malformed write from
          // inside Traefik corrupt the routes.
          `${this.configVolume()}:${BootstrapIngressService.CONFIG_MOUNT}:ro`,
          // Container discovery for the docker provider.
          `${this.socketPath()}:/var/run/docker.sock:ro`,
        ],
        NetworkMode: this.platformNetwork(),
      },
    });

    await this.docker.startContainer(name);
  }

  // ─── Engine helpers ───────────────────────────────────────────────────────

  /** The container's state, or null when it does not exist. */
  private async inspect(): Promise<{
    running: boolean;
    image: string;
    port: string | null;
    networks: string[];
  } | null> {
    try {
      const info = await this.docker.getContainerInfo(BootstrapIngressService.CONTAINER_NAME);
      const bindings = info.HostConfig?.PortBindings ?? {};
      return {
        running: info.State.Running,
        image: info.Config.Image ?? "",
        port: bindings["80/tcp"]?.[0]?.HostPort ?? null,
        networks: Object.keys(info.NetworkSettings?.Networks ?? {}),
      };
    } catch {
      // A missing container is the normal first-boot case, not an error.
      return null;
    }
  }

  /**
   * Whether a running container already matches the desired state.
   *
   * Compares only what CANNOT be changed without recreating the container —
   * image, published port, network — because those are exactly the values a
   * stale container would hold. Comparing more (env, labels) would recreate for
   * changes that do not affect behaviour and needlessly drop live connections.
   */
  private matchesDesired(state: { image: string; port: string | null; networks: string[] }): boolean {
    const portMatches = state.port === String(this.entryPort());
    const imageMatches = state.image === this.image();
    const networkMatches = state.networks.includes(this.platformNetwork());
    return portMatches && imageMatches && networkMatches;
  }

  /** Force-remove the container, tolerating "already gone". */
  private async remove(): Promise<void> {
    try {
      await this.docker.removeContainer(BootstrapIngressService.CONTAINER_NAME);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!/no such container|404|already in progress/i.test(detail)) throw error;
    }
  }

  /**
   * Wait until the entry port ACCEPTS a connection.
   *
   * Probes the host-gateway address rather than `127.0.0.1`: this code runs
   * inside a container, and the port is published on the HOST, so loopback
   * would test this container's own namespace and always fail.
   *
   * Any TCP acceptance counts, including a 404 — a 404 from Traefik proves the
   * router is ALIVE and merely has no matching rule yet (the wizard's route is
   * published separately). Requiring a 200 would conflate "ingress up" with
   * "route configured", and the two are deliberately separate here.
   */
  /**
   * Assert the ingress answers within the boot budget, or throw.
   */
  private async verifyReachable(): Promise<void> {
    const reachable = await this.portAnswers(BootstrapIngressService.READY_TIMEOUT_MS);
    if (!reachable) {
      throw new Error(
        `ingress started but did not answer on port ${String(this.entryPort())} within ` +
          `${String(BootstrapIngressService.READY_TIMEOUT_MS / 1000)}s`,
      );
    }
  }

  /** Poll the entry port until it answers, or the budget runs out. */
  private async portAnswers(budgetMs: number): Promise<boolean> {
    const deadline = Date.now() + budgetMs;
    const host = this.hostGateway();
    while (Date.now() < deadline) {
      if (await this.tcpAnswers(host, this.entryPort())) return true;
      await new Promise((resolve) => setTimeout(resolve, BootstrapIngressService.READY_POLL_MS));
    }
    return false;
  }

  /** One TCP connect attempt against host:port. */
  private tcpAnswers(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      // A raw socket, not `fetch`: Traefik answers :80 as an HTTP router but
      // the question here is "is anything listening", and a socket avoids
      // caring which response shape a misrouted request produces.
      const socket = new Socket();
      const done = (result: boolean) => {
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(1_500);
      socket.once("connect", () => done(true));
      socket.once("timeout", () => done(false));
      socket.once("error", () => done(false));
      socket.connect(port, host);
    });
  }

  /**
   * The address that reaches PUBLISHED host ports from inside this container.
   *
   * Docker resolves `host.docker.internal` to the host on Desktop and on Linux
   * with `--add-host=host.docker.internal:host-gateway` (which the API's compose
   * config sets). Falls back to the default-gateway IP for engines without it.
   */
  private hostGateway(): string {
    const configured = process.env.HOST_GATEWAY_ADDRESS;
    if (configured !== undefined && configured.length > 0) return configured;
    return "host.docker.internal";
  }

  /** Operator-facing note about which incarnation currently owns the ingress. */
  private ingressStateNote(): string {
    return "wizard reachable through the ingress";
  }
}

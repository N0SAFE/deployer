import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { EnvService } from "@/config/env/env.module";

/**
 * The compose network alias Traefik uses to reach this app.
 *
 * A shared literal, not an env var: every profile declares the same alias
 * (`setup-dev` and `setup-prod` both set `aliases: [setup-dev, setup]`), so a
 * variable would be configuration with exactly one possible value. It IS a
 * contract with the compose files — if an alias is ever renamed, this constant
 * and the two profiles must change together.
 */
const SETUP_SERVICE_ALIAS = "setup";

/**
 * Rewrites the two dynamic Traefik config files that decide who owns each
 * hostname, as the LAST step of onboarding.
 *
 * ── WHAT IT WRITES, AND WHY ONLY THIS ───────────────────────────────────────
 *
 *   | file               | owner   | content at handover                          |
 *   |--------------------|---------|----------------------------------------------|
 *   | dynamic-api.yml    | setup   | api.<host>   → the API (container OR swarm)  |
 *   | dynamic-setup.yml  | setup   | setup.<host> → the API's `/setup/done` page  |
 *
 * Every OTHER dynamic file belongs to the API and is written by the API's own
 * `TraefikPlatformConfigService` once it boots. Touching them here would be a
 * second writer for the same file — the exact race the per-owner file split
 * exists to prevent.
 *
 * ── WHY THE HANDOVER IS A FILE, NOT A PACKAGE DEPENDENCY ────────────────────
 * The API's route builders (`PlatformRouteConfigService`, `TraefikConfigBuilder`)
 * live in `apps/api` because they read the API's Postgres: platform config,
 * app instances, DB-driven routes. Setup has none of that and needs none of it
 * — it needs TWO routers on TWO hostnames. Importing 1.4k LOC of ingress policy
 * (plus its database) to emit four lines of YAML is exactly the over-extraction
 * the plan's §5.2 audit rejected. So the YAML is written here, explicitly, and
 * the shape is the same `http.routers` / `http.services` document the API's
 * builder emits — a file Traefik reads, not a second implementation of routing
 * policy.
 *
 * ── WHY SETUP OWNS dynamic-api.yml AT ALL ───────────────────────────────────
 * Before the API boots there is no process able to write it, and `api.<host>`
 * would be unrouted for the whole of onboarding. Setup writes the route first
 * (pointing at whatever currently answers) and re-points it after the swap, so
 * the hostname is CONTINUOUSLY answerable — plan §9.2's
 * "never let a URL change owner by disappearing" rule.
 */
@Injectable()
export class IngressHandoverService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IngressHandoverService.name);

  /**
   * Traefik's router priority for the setup hostname.
   *
   * Higher than the API's console router (2000) on purpose: `setup.<host>` must
   * win outright for its own hostname, and an explicit value keeps that true
   * even if the API later adds a broader Host rule. Rule-length precedence would
   * probably also suffice — which is exactly why this states the intent instead
   * of relying on a tiebreak.
   */
  private static readonly SETUP_ROUTER_PRIORITY = 3000;

  constructor(private readonly env: EnvService) {}

  /**
   * Directory the live Traefik file provider watches.
   *
   * Same variable and same default as the API's own services, so both processes
   * resolve the SAME mount — a mismatch here would write the handover into a
   * directory nothing reads, and the failure would look like "Traefik ignores
   * us" rather than a config error.
   */
  configDir(): string {
    return this.env.get("TRAEFIK_CONFIG_BASE_PATH") ?? "/app/traefik-configs";
  }

  /** `api.<prefix>deployer.localhost` — the platform hostname grammar. */
  apiHostname(): string {
    return this.prefixedHost("api");
  }

  /** `setup.<prefix>deployer.localhost`. */
  setupHostname(): string {
    return this.prefixedHost("setup");
  }

  /**
   * `web.<prefix>deployer.localhost` — the dashboard's public surface.
   *
   * Needed by the handover to verify the dashboard is actually ROUTED before
   * declaring setup finished: the managed web container can be running while the
   * ingress has no rule for this host, which is a browser-visible 404 on the
   * operator's first click.
   */
  webHostname(): string {
    return this.prefixedHost("web");
  }

  private prefixedHost(service: "api" | "setup" | "web"): string {
    const prefix = this.env.get("DEPLOYER_PREFIX");
    const base = "deployer.localhost";
    return prefix === "" ? `${service}.${base}` : `${service}.${prefix}.${base}`;
  }

  /**
   * Point `api.<host>` at a backend.
   *
   * Called TWICE with the same router name and different backends:
   *   1. before the swap — at whatever currently serves (the API's container
   *      address), so the hostname is never unrouted;
   *   2. after the swap — at the swarm service's DNS name.
   *
   * Reusing the router and service names across both calls is what makes this a
   * RETARGET rather than two competing routers: Traefik's file provider keys by
   * name, so the second write replaces the first atomically enough for a
   * reload, and there is never a moment with two `platform-api` routers.
   */
  async pointApiAt(backendUrl: string): Promise<void> {
    const file = path.join(this.configDir(), "dynamic-api.yml");
    await this.write(
      file,
      this.document([
        {
          router: "platform-api",
          rule: `Host(\`${this.apiHostname()}\`)`,
          service: "platform-api-svc",
          backend: backendUrl,
          priority: null,
        },
      ]),
      `api → ${backendUrl}`,
    );
  }

  /**
   * Route `setup.<host>` to this app as soon as the process is up.
   *
   * ── WHY THIS IS HERE AND NOT IN THE HANDOVER ─────────────────────────────
   * The handover writes `dynamic-setup.yml` at the END, pointing at the done
   * page. Nothing wrote it at the START, so `setup.<host>` had no router for the
   * whole of onboarding — the operator would see a Traefik 404 on the only page
   * that exists to fix a broken setup.
   *
   * ── WHY A FAILURE IS NON-FATAL ───────────────────────────────────────────
   * Throwing here would restart-loop the container, and a restarted container
   * still has no route: the failure would be identical on every attempt while
   * also destroying the wizard's ability to report it. Logging loudly at ERROR
   * keeps the process serving on its internal port (where compose's healthcheck
   * and the handover still work) and names the exact path to inspect.
   *
   * The handover rewrites the same file later, so a transient failure here is
   * also self-healing in the common case.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.pointSetupAtSelf();
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Could not publish the wizard route — ${this.setupHostname()} will 404 until the ` +
          `handover retries. Check that TRAEFIK_CONFIG_BASE_PATH (${this.configDir()}) is ` +
          `writable and shared with Traefik. Cause: ${detail}`,
      );
    }
  }

  /**
   * Point `setup.<host>` at THIS app — the wizard itself.
   *
   * Called FIRST, at boot, before any cluster or handover work. Without it the
   * hostname has no router at all until the handover rewrites the file, so the
   * operator would get a Traefik 404 for the ENTIRE onboarding — the one phase
   * whose only purpose is to be reachable.
   *
   * WHY AT BOOT AND NOT WHEN THE CLUSTER SUCCEEDS: a failed cluster is exactly
   * when the wizard matters most. It is the only surface that can show the
   * operator what went wrong and let them retry, so the route must exist before
   * the first attempt rather than after it succeeds.
   *
   * Order-independent with respect to Traefik: the file lands on the shared
   * volume, and Traefik's file provider reads it on its own start (`watch: true`
   * also picks up later changes), so neither process needs the other to be up.
   */
  async pointSetupAtSelf(): Promise<void> {
    const file = path.join(this.configDir(), "dynamic-setup.yml");
    await this.write(
      file,
      this.document([
        {
          router: "platform-setup",
          rule: `Host(\`${this.setupHostname()}\`)`,
          service: "platform-setup-svc",
          backend: this.selfBackendUrl(),
          priority: IngressHandoverService.SETUP_ROUTER_PRIORITY,
        },
      ]),
      `setup → this app (${this.selfBackendUrl()})`,
    );
  }

  /**
   * This app's address as Traefik must reach it.
   *
   * The HOST is the compose network alias (both profiles declare `setup`), not
   * a hostname: Traefik resolves it over the docker network, where the public
   * hostname means nothing. The PORT comes from the env because it is genuinely
   * configurable, and a hardcoded 3016 would silently disagree with a container
   * that bound something else.
   */
  private selfBackendUrl(): string {
    return `http://${SETUP_SERVICE_ALIAS}:${String(this.env.get("SETUP_APP_PORT"))}`;
  }

  /**
   * Point `setup.<host>` at the API's static done page.
   *
   * REWRITTEN, never deleted (plan §9.2): deleting the router would leave
   * `setup.<host>` resolving to no route, i.e. a Traefik 404 for an operator who
   * bookmarked the wizard. Keeping the router and only changing its backend
   * means the hostname is answerable before, during and after the handover —
   * it simply changes from the wizard to the "setup done" page.
   */
  async pointSetupAtDonePage(apiBackendUrl: string): Promise<void> {
    const file = path.join(this.configDir(), "dynamic-setup.yml");
    await this.write(
      file,
      this.document([
        {
          router: "platform-setup",
          rule: `Host(\`${this.setupHostname()}\`)`,
          service: "platform-setup-svc",
          backend: `${apiBackendUrl}/setup/done`,
          priority: IngressHandoverService.SETUP_ROUTER_PRIORITY,
        },
      ]),
      `setup → ${apiBackendUrl}/setup/done`,
    );
  }

  /**
   * Emit one `http.routers` / `http.services` pair per entry.
   *
   * SHAPE MATCHES THE API'S BUILDER: a single `http:` root (Traefik's file
   * provider rejects two `http:` keys in one document), routers referenced by
   * their service name, and the backend spelled out in a `loadBalancer`.
   */
  private document(
    entries: Array<{
      router: string;
      rule: string;
      service: string;
      backend: string;
      priority: number | null;
    }>,
  ): string {
    const routers = entries
      .map((e) => {
        const priority = e.priority === null ? "" : `      priority: ${String(e.priority)}\n`;
        return (
          `    ${e.router}:\n` +
          `      rule: ${JSON.stringify(e.rule)}\n` +
          `      service: ${e.service}\n` +
          `      entryPoints:\n` +
          `        - web\n` +
          priority
        );
      })
      .join("\n");

    const services = entries
      .map(
        (e) =>
          `    ${e.service}:\n` +
          `      loadBalancer:\n` +
          `        servers:\n` +
          `          - url: ${JSON.stringify(e.backend)}\n`,
      )
      .join("\n");

    return (
      "# Written by the setup app's handover. The Traefik supervisor does NOT\n" +
      "# own this file while setup runs; ownership passes to the API's own\n" +
      "# config service once it boots.\n" +
      "http:\n" +
      "  routers:\n" +
      routers +
      "\n  services:\n" +
      services
    );
  }

  /**
   * Write atomically: temp file + rename.
   *
   * Traefik's file provider watches this directory with `watch: true`. A plain
   * `writeFile` can be observed HALF-WRITTEN, and a partially-read YAML makes
   * Traefik discard the whole configuration — dropping every route in the file,
   * not just the truncated one. `rename` within the same directory is atomic on
   * POSIX, so the provider only ever sees a complete document.
   */
  private async write(file: string, contents: string, describe: string): Promise<void> {
    await mkdir(this.configDir(), { recursive: true });

    const temporary = `${file}.tmp`;
    await writeFile(temporary, contents, "utf8");
    await rename(temporary, file);

    this.logger.log(`Ingress retargeted: ${describe} (${file})`);
  }
}

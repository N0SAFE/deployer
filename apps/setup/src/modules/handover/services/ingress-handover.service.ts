import { Injectable, Logger } from "@nestjs/common";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { EnvService } from "@/config/env/env.module";

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
export class IngressHandoverService {
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

  private prefixedHost(service: "api" | "setup"): string {
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

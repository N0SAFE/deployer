import { Controller, Get, Inject, Module, Optional, Res } from "@nestjs/common";
import type { Response } from "express";

import { AllowAnonymous } from "../core/modules/auth/decorators/decorators";

/**
 * What a service reports as "ready".
 *
 * A service is ready when the things IT needs are up (its database pool, its
 * peers). Reporting readiness is therefore a per-service decision, not something
 * a shared package can guess — so the service binds this port and the module
 * below owns only the TRANSPORT (`/health`, `/health/ready`).
 */
export type ServiceReadinessPort = {
	/** `true` when the service can serve traffic. Never throws: "not ready" is an answer. */
	isReady(): Promise<boolean>;
}

/** DI token for {@link ServiceReadinessPort}. */
export const SERVICE_READINESS = Symbol("api-server:service-readiness");

/**
 * The probes, as a module a service imports.
 *
 * ── WHY THE READINESS PROVIDER IS OPTIONAL ──────────────────────────────────
 * An earlier version declared a default `AlwaysReadyService` as this module's own
 * provider. That silently fought `PreflightModule`, which also binds the token: a
 * service importing both had two providers for one token, and Nest resolved
 * whichever it happened to see — so readiness could report "always ready" while
 * the boot gate had failed, which is the exact contradiction the two exist to
 * make impossible.
 *
 * Resolving it with `@Optional()` removes the conflict: if something bound the
 * port, its verdict is used; if nothing did, the answer is ready (nothing
 * declared a requirement, so there is nothing to fail). No default provider means
 * nothing to collide with.
 */
@Controller("health")
// ── THE PROBES MUST NOT REQUIRE A SESSION ────────────────────────────────────
// `AuthModule` registers a GLOBAL `APP_GUARD`, so every route needs a session
// unless it opts out via this metadata — and without it BOTH probes answered
// 401 to their own healthcheck:
//
//   CMD-SHELL wget --spider http://127.0.0.1:3101/health/ready
//   -> HTTP/1.1 401 Unauthorized
//   -> docker marks the container unhealthy, `bff` gates on those containers,
//      and the whole stack stays down
//
// An orchestrator's probe cannot authenticate: it has no session and must not be
// given one. `AllowAnonymous` (the `PUBLIC` metadata the guard reads) is the
// supported opt-out, and the same reason applies to every service's probes.
@AllowAnonymous()
export class ServiceHealthController {
	constructor(
		@Optional() @Inject(SERVICE_READINESS) private readonly readiness: ServiceReadinessPort | null,
	) {}

	/**
	 * LIVENESS. Never consults a dependency.
	 *
	 * A liveness probe that fails when a dependency is down makes an orchestrator
	 * restart a healthy process in a loop — and buries the real fault behind a
	 * restart storm. If this process can answer, it is alive.
	 */
	@Get()
	liveness(@Res() res: Response): void {
		res.status(200).json({ status: "ok", uptime: process.uptime() });
	}

	/**
	 * READINESS. The gate a compose/swarm healthcheck should target.
	 *
	 * Returns 503 while the service cannot serve, from whatever bound the port
	 * (preflight at boot, or the health registry). Reads a CACHED verdict rather
	 * than doing I/O: this endpoint is polled forever, and running the probes per
	 * request is what the platform already got wrong once.
	 */
	@Get("ready")
	async ready(@Res() res: Response): Promise<void> {
		// ── WHY THIS FALLBACK IS `true`, AND WHY IT IS NO LONGER A LIE ───────
		// `?? true` only applies when nothing bound `SERVICE_READINESS` — i.e. an
		// app that declared no dependencies, so there is nothing to prove.
		//
		// It used to be a lie in practice, because `PreflightModule` was NOT global
		// and this module never imported it: the token resolved to `null` even in
		// apps that DID declare dependencies, and the fallback reported "ready"
		// while preflight was still retrying (`/health/ready` answered 200 with
		// 317 failed attempts logged). `PreflightModule` is now `global: true`, so
		// the binding always reaches this controller and the verdict is the real
		// one. Keep the fallback for the genuinely dependency-free case.
		const ready = await Promise.resolve(this.readiness?.isReady() ?? true).catch(() => false);
		res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not-ready" });
	}
}

@Module({
	controllers: [ServiceHealthController],
	// NO providers and NO exports.
	//
	// The readiness port belongs to whoever BINDS it (`PreflightModule`, or the
	// health registry), and that module is the one that exports it. Declaring an
	// export here would make this module claim to provide a token it does not —
	// which Nest rejects at boot with `UnknownExportException`, breaking every
	// service that imports this one.
})
export class ServiceHealthModule {}

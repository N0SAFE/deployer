import { NestFactory } from "@nestjs/core";
import type { NestApplicationOptions } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import express from "express";
import type { INestApplication, Type } from "@nestjs/common";

import { buildAllowedOrigins, resolveCorsDecision, CORS_ALLOWED_HEADERS } from "../core/utils/cors.utils";
import { logger } from "@deployer/logger";
import { PreflightService } from "./preflight/preflight.service";
import type { PreflightDependency, PreflightReport } from "./preflight/types";

/**
 * CORS for a platform app.
 *
 * Cookie presence separates the credentialed (allowlisted) path from the
 * credential-free app-instance-token path — see `resolveCorsDecision`. Every app
 * uses the same policy because a browser reaches the BFF and (through it)
 * nothing else: a service's CORS answer only ever matters to the BFF, and making
 * it identical removes a class of "works locally, 403 in compose" reports.
 */
export function createCorsMiddleware(): express.RequestHandler {
	const corsAllowedOrigins = buildAllowedOrigins(process.env as Record<string, string | undefined>);
	const isDevelopment = process.env.NODE_ENV !== "production";

	return (req, res, next) => {
		const cookieHeader = req.headers.cookie;
		const hasCookieHeader = typeof cookieHeader === "string" && cookieHeader.length > 0;

		const decision = resolveCorsDecision({
			origin: req.headers.origin,
			hasCookieHeader,
			allowedOrigins: corsAllowedOrigins,
			isDevelopment,
		});

		if (decision.allowOrigin) {
			res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
			if (decision.allowCredentials) {
				res.setHeader("Access-Control-Allow-Credentials", "true");
				res.setHeader("Access-Control-Expose-Headers", "Set-Cookie");
			}
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
			res.setHeader("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS.join(", "));
		}

		if (req.method === "OPTIONS") {
			res.status(204).end();
			return;
		}

		next();
	};
}

/** The `NestFactory` options every app shares. */
export function apiAppOptions(): NestApplicationOptions {
	return {
		// `snapshot` traces the whole bootstrap on every start, costing boot time and
		// memory, so it is opt-in rather than implied by NODE_ENV: a dev who is not
		// debugging startup should not pay for it. Set APP_BOOT_SNAPSHOT=true to get
		// a readable boot trace.
		snapshot: process.env.APP_BOOT_SNAPSHOT === "true",
		// Nest must not parse the body twice: each app hands it an Express
		// instance it built itself (so CORS and the probes can answer before the
		// graph resolves).
		bodyParser: false,
	};
}

/** The bare Express instance an app's middleware is attached to. */
export function createGateway(): express.Express {
	const gateway = express();
	gateway.use(createCorsMiddleware());
	return gateway;
}

/**
 * Liveness, registered on Express BEFORE Nest boots.
 *
 * `/health` must answer from the moment the port is bound. Registering it as a
 * controller would be a lie in exactly the window the orchestrator probes it
 * most: while the graph is still resolving, no controller exists, so the probe
 * would connection-refuse and report a healthy process as dead.
 */
export function mountLiveness(gateway: express.Express): void {
	gateway.get("/health", (_req, res) => {
		res.status(200).json({ status: "ok", uptime: process.uptime() });
	});
}

/**
 * Create a platform app from a root module, UNSTARTED.
 *
 * `init()` is called but `listen()` is not: the caller owns the port, because
 * the port is the one thing that differs between the apps (and the tests bind
 * `0` to avoid colliding with a live dev stack).
 *
 * Deliberately not `createApplicationContext`: that skips the HTTP adapter, so
 * the app a `compile`-style check validates would not be the app that ships.
 */
export async function createApiServerApp(rootModule: Type<unknown>): Promise<INestApplication> {
	const gateway = createGateway();
	mountLiveness(gateway);

	const app = await NestFactory.create(rootModule, new ExpressAdapter(gateway), apiAppOptions());
	app.enableShutdownHooks();
	await app.init();

	return app;
}

/** Build the graph WITHOUT an HTTP adapter, for a boot check. */
export async function createCompileContext(rootModule: Type<unknown>) {
	return NestFactory.createApplicationContext(rootModule, apiAppOptions());
}

/**
 * Start a platform app on `port`, proving its dependencies before it serves.
 *
 * The single entry point every app's `main.ts` calls, so "what a started app
 * looks like" is defined once — including the ORDER, which is load-bearing:
 *
 *   1. build the graph and `init()` it        (DI resolved, providers alive)
 *   2. **bind the port**                      (liveness answers from here)
 *   3. run dependency preflight               (`/health/ready` is 503 until it passes)
 *   4. exit non-zero if a dependency is missing
 *
 * BINDING BEFORE PREFLIGHT is deliberate and not an optimisation. A swarm or
 * compose healthcheck whose target port does not exist yet reports the task as
 * DEAD, and the orchestrator then restarts a process that is merely waiting for
 * its database — a restart loop that never converges. Binding first means the
 * probe always gets an answer, and the answer during startup is the honest one:
 * liveness 200, readiness 503.
 *
 * WHAT THIS DOES NOT DO: it does not throw when a dependency is missing. The
 * exit code is the signal, and a thrown error here would be caught by `main.ts`
 * and reported as an unhandled boot failure — which reads like a code defect
 * rather than "the database is not up yet".
 */
export async function bootstrapApiServer(options: {
	rootModule: Type<unknown>;
	port: number;
	name: string;
	/**
	 * Dependency set to prove before serving. Omit for an app with none, in which
	 * case the port binds and the app is immediately ready.
	 */
	dependencies?: readonly PreflightDependency[];
}): Promise<INestApplication> {
	const app = await createApiServerApp(options.rootModule);

	// `init()` already ran inside `createApiServerApp`, so the container is live.
	// Resolve preflight LAZILY: an app that declares no dependencies never
	// imports `PreflightModule`, and `strict: false` turns that into `null`
	// instead of an unresolvable-dependency crash on a correct configuration.
	const preflight = app.get<PreflightService | null>(PreflightService, { strict: false });

	// Bind BEFORE the checks. See the ordering note above.
	await app.listen(options.port, "0.0.0.0");
	logger.scope(options.name).info(`🚀 ${options.name} listening on :${String(options.port)}`);

	if (preflight !== null) {
		const report = await preflight.run();
		if (!report.ready) {
			// Close the listener so the port is not left answering probes with a
			// process that will not serve, then exit non-zero for the orchestrator.
			await app.close();
			throw new DependencyNotReadyError(options.name, report);
		}
	}

	return app;
}

/**
 * A dependency the app declares was not usable in time.
 *
 * A distinct type so `main.ts` can exit with the documented "engine/dependency
 * unavailable" code instead of the generic failure code, and so the CLI — which
 * runs the same checks — can recognise the same condition.
 */
export class DependencyNotReadyError extends Error {
	readonly appName: string;
	readonly report: PreflightReport;

	constructor(appName: string, report: PreflightReport) {
		super(
			`${appName} cannot serve: ${report.results
				.filter((result) => result.outcome === "failed")
				.map((result) => `${result.dependency} (${result.detail})`)
				.join(", ")}`,
		);
		this.name = "DependencyNotReadyError";
		this.appName = appName;
		this.report = report;
	}
}

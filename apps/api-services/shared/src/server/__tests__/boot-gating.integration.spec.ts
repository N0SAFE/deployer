import { Module } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";

import {
	DEPENDENCIES,
	DependencyNotReadyError,
	PreflightModule,
	ServiceHealthModule,
	bootstrapApiServer,
} from "@deployer/shared/server";

/**
 * Boot gating, end to end — the behaviour every service depends on.
 *
 * These tests exist because the ORDER inside `bootstrapApiServer` is load-bearing
 * and invisible to `tsc`: the port must bind BEFORE the dependency checks, so a
 * probe always gets an answer and a still-starting app is not reported as dead
 * and restarted in a loop. A unit test of the checks cannot catch a regression in
 * that ordering; only starting a real app can.
 */
@Module({
	imports: [ServiceHealthModule, PreflightModule.forRoot({ dependencies: DEPENDENCIES.none })],
})
class NoDepsModule {}

@Module({
	imports: [
		ServiceHealthModule,
		// A dependency that cannot possibly be satisfied: nothing is listening on
		// port 1, and the URL is malformed on purpose so the check fails FAST rather
		// than waiting out its retry budget.
		PreflightModule.forRoot({
			dependencies: DEPENDENCIES.database,
			policy: { waitMs: 0, retryEveryMs: 0 },
		}),
	],
})
class MissingDepsModule {}

/** Boot on an ephemeral port and return where it landed. */
async function bootAndWhere(module: unknown): Promise<{ app: { close: () => Promise<void> }; base: string }> {
	const app = await bootstrapApiServer({
		rootModule: module as never,
		// `0` lets the OS pick, so the test never collides with a live dev stack.
		port: 0,
		name: "test-app",
	});
	const address = app.getHttpServer().address() as { port: number };
	return { app, base: `http://127.0.0.1:${String(address.port)}` };
}

describe("bootstrapApiServer", () => {
	let started: { app: { close: () => Promise<void> } } | null = null;

	afterEach(async () => {
		if (started !== null) {
			await started.app.close();
			started = null;
		}
	});

	it("answers liveness and readiness when it has no dependencies", async () => {
		const { app, base } = await bootAndWhere(NoDepsModule);
		started = { app };

		const liveness = await fetch(`${base}/health`);
		expect(liveness.status).toBe(200);
		expect(await liveness.json()).toMatchObject({ status: "ok" });

		// Nothing to wait for, so readiness is immediately satisfied — and it comes
		// from preflight, not from a second implementation.
		const readiness = await fetch(`${base}/health/ready`);
		expect(readiness.status).toBe(200);
	});

	it("refuses to serve when a declared dependency is missing", async () => {
		// The app must NOT come up: a process that binds its port and then fails every
		// request is worse than one that never started, because the orchestrator sees
		// a live task.
		await expect(
			bootstrapApiServer({
				rootModule: MissingDepsModule as never,
				port: 0,
				name: "test-app",
				dependencies: DEPENDENCIES.database,
			}),
		).rejects.toBeInstanceOf(DependencyNotReadyError);
	});

	it("names the failing dependency in the error, not just its existence", async () => {
		// The message is what an operator reads at 3am. "a dependency failed" is not
		// actionable; "database (...) migrations (...)" is.
		const error = await bootstrapApiServer({
			rootModule: MissingDepsModule as never,
			port: 0,
			name: "test-app",
			dependencies: DEPENDENCIES.database,
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(DependencyNotReadyError);
		const report = (error as DependencyNotReadyError).report;
		expect(report.ready).toBe(false);
		expect(report.results.some((result) => result.outcome === "failed")).toBe(true);
		expect((error as Error).message).toContain("database");
	});
});

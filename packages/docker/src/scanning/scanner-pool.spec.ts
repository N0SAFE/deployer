import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import { DockerInvalid } from "../errors/errors";
import { makeScannerPool, type ScannerConfig } from "./scanner-pool";

async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return exit.value;
	throw Cause.squash(exit.cause);
}

const config: ScannerConfig = { image: "scanner:1", buildContext: undefined, idleTimeoutMs: 60_000, autoScanDisabled: false };

function pool(overrides: { config?: Partial<ScannerConfig>; running?: boolean; imageExists?: boolean } = {}) {
	const create = vi.fn(() => Effect.succeed({ id: "container-1" }));
	const start = vi.fn(() => Effect.void);
	const stop = vi.fn(() => Effect.void);
	const capture = vi.fn(() => Effect.succeed({ exitCode: 0, output: "ok" }));
	const inspect = vi.fn(() =>
		overrides.running === true
			? Effect.succeed({ Id: "existing-1", State: { Running: true } } as never)
			: Effect.fail(new DockerInvalid({ reason: "no such container" })),
	);
	const docker = {
		containers: { create, start, stop, inspect, remove: vi.fn(() => Effect.void) },
		images: { exists: () => Effect.succeed(overrides.imageExists ?? true) },
		exec: { capture },
		build: { image: vi.fn(() => Effect.void) },
	};
	return {
		create,
		start,
		stop,
		capture,
		pool: makeScannerPool({
			docker: docker as never,
			config: { ...config, ...overrides.config },
			access: { socketBind: "/var/run/docker.sock:/var/run/docker.sock" },
		}),
	};
}

describe("ScannerPool", () => {
	it("starts nothing when auto-scan is disabled", async () => {
		const { pool: p, create } = pool({ config: { autoScanDisabled: true } });

		expect(await run(p.ensureRunning("trivy"))).toBe(false);
		expect(create).not.toHaveBeenCalled();
	});

	it("creates the scanner container with the engine socket bound, then reports it running", async () => {
		const { pool: p, create, start } = pool();

		expect(await run(p.ensureRunning("trivy"))).toBe(true);

		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "deployer-scanner-trivy",
				Env: ["DOCKER_HOST=unix:///var/run/docker.sock"],
				HostConfig: { AutoRemove: true, Binds: ["/var/run/docker.sock:/var/run/docker.sock"] },
			}),
		);
		expect(start).toHaveBeenCalledWith("container-1");
		await run(p.stopAll);
	});

	it("adopts a container that is already running instead of creating one", async () => {
		const { pool: p, create } = pool({ running: true });

		expect(await run(p.ensureRunning("grype"))).toBe(true);

		expect(create).not.toHaveBeenCalled();
		await run(p.stopAll);
	});

	it("reports false when the runner image is missing and cannot be built", async () => {
		const { pool: p, create } = pool({ imageExists: false });

		expect(await run(p.ensureRunning("dive"))).toBe(false);
		expect(create).not.toHaveBeenCalled();
	});

	it("refuses to exec in a scanner that was never started", async () => {
		const { pool: p } = pool();

		await expect(run(p.exec("trivy", ["trivy", "--version"]))).rejects.toBeInstanceOf(DockerInvalid);
	});

	it("returns a non-zero exit as data", async () => {
		const { pool: p, capture } = pool();
		await run(p.ensureRunning("trivy"));
		capture.mockReturnValue(Effect.succeed({ exitCode: 1, output: "3 vulnerabilities" }));

		const result = await run(p.exec("trivy", ["trivy", "image", "x"]));

		expect(result).toEqual(expect.objectContaining({ exitCode: 1, output: "3 vulnerabilities" }));
		await run(p.stopAll);
	});

	it("stops the container and forgets it", async () => {
		const { pool: p, stop } = pool();
		await run(p.ensureRunning("trivy"));

		await run(p.stop("trivy"));

		expect(stop).toHaveBeenCalledWith("container-1");
		await expect(run(p.exec("trivy", ["x"]))).rejects.toBeInstanceOf(DockerInvalid);
	});
});

import { Context, Effect, Fiber, Layer } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";

import { DockerEngine, type DockerEngineShape } from "../engine/docker-engine";
import { DockerInvalid } from "../errors/errors";

export type ScannerType = "trivy" | "grype" | "dive";

export type ScannerExecResult = {
	readonly exitCode: number;
	readonly output: string;
	readonly durationMs: number;
};

/** What the pool is told by its app: values, never an environment. */
export type ScannerConfig = {
	/** Image to run scans with. */
	readonly image: string;
	/** Build context used to build the image when it is missing. */
	readonly buildContext: string | undefined;
	/** Idle time after which a scanner's shared container is stopped. */
	readonly idleTimeoutMs: number;
	/** When true, no shared scanner container is ever started. */
	readonly autoScanDisabled: boolean;
};

/** How scanner containers reach the engine they drive. */
export type ScannerEngineAccess = {
	/** `host:container` bind of the engine's unix socket, when it is reached over one. */
	readonly socketBind: string | null;
	/** Set when the engine is reached over TCP. */
	readonly tcp?: { readonly host: string; readonly port: number };
};

export class ScannerConfigService extends Context.Service<ScannerConfigService, ScannerConfig>()("docker/ScannerConfig") {}
export class ScannerEngineAccessService extends Context.Service<ScannerEngineAccessService, ScannerEngineAccess>()(
	"docker/ScannerEngineAccess",
) {}

/**
 * Long-lived scanner containers (trivy, grype, dive), started on first use, adopted when one is
 * already running, and stopped after an idle period. When the runner image is missing it is built
 * once; when that fails, callers fall back to per-scan containers.
 */
export type ScannerPoolShape = {
	/**
	 * Makes sure the scanner's shared container is running. False when auto-scan is disabled or the
	 * container could not be started: callers then run their scan another way.
	 */
	readonly ensureRunning: (scanner: ScannerType) => Effect.Effect<boolean>;
	/** Runs `cmd` in the scanner's container. A non-zero exit is data: scanners exit non-zero when they find something. */
	readonly exec: (scanner: ScannerType, cmd: string[]) => Effect.Effect<ScannerExecResult, DockerInvalid>;
	readonly stop: (scanner: ScannerType) => Effect.Effect<void>;
	readonly stopAll: Effect.Effect<void>;
	/** Clears cached scanner data when no scanner has been used for ten days. */
	readonly cleanStaleImages: Effect.Effect<void>;
};

export class ScannerPool extends Context.Service<ScannerPool, ScannerPoolShape>()("docker/ScannerPool") {
	/** Stops every shared container when the layer's scope closes. */
	static readonly Live: Layer.Layer<ScannerPool, never, DockerEngine | ScannerConfigService | ScannerEngineAccessService> =
		Layer.effect(
			ScannerPool,
			Effect.gen(function* () {
				const pool = makeScannerPool({
					docker: yield* DockerEngine,
					config: yield* ScannerConfigService,
					access: yield* ScannerEngineAccessService,
				});
				yield* Effect.addFinalizer(() => pool.stopAll);
				return pool;
			}),
		);
}

const SCANNER_CONTAINER_NAMES: Record<ScannerType, string> = {
	trivy: "deployer-scanner-trivy",
	grype: "deployer-scanner-grype",
	dive: "deployer-scanner-dive",
};
const SCANNER_TYPES: readonly ScannerType[] = ["trivy", "grype", "dive"];

const READY_TIMEOUT_MS = 15_000;
const READY_POLL_MS = 500;
const IMAGE_CLEANUP_THRESHOLD_MS = 10 * 24 * 60 * 60 * 1_000;
const IMAGE_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;

type ScannerState = {
	containerId: string | null;
	lastActivityAt: number;
	idleTimer: Fiber.Fiber<void> | null;
	starting: Promise<boolean> | null;
};

/** The directories that may hold the scanner-runner Dockerfile: the configured one, then up from the working directory. */
function scannerBuildContext(config: ScannerConfig): string | null {
	const candidates: string[] = [];
	if (config.buildContext !== undefined && config.buildContext.trim().length > 0) {
		candidates.push(path.resolve(config.buildContext.trim()));
	}
	let dir = path.resolve(process.cwd());
	for (let depth = 0; depth < 6; depth += 1) {
		candidates.push(path.join(dir, "docker", "scanner-runner"));
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return candidates.find((candidate) => fs.existsSync(path.join(candidate, "Dockerfile"))) ?? null;
}

export function makeScannerPool(deps: {
	readonly docker: DockerEngineShape;
	readonly config: ScannerConfig;
	readonly access: ScannerEngineAccess;
}): ScannerPoolShape {
	const { docker, config, access } = deps;
	const states: Record<ScannerType, ScannerState> = {
		trivy: { containerId: null, lastActivityAt: 0, idleTimer: null, starting: null },
		grype: { containerId: null, lastActivityAt: 0, idleTimer: null, starting: null },
		dive: { containerId: null, lastActivityAt: 0, idleTimer: null, starting: null },
	};
	const imageBuilds = new Map<string, Promise<boolean>>();
	const warnedUnavailable = new Set<string>();
	let cleanupTimer: Fiber.Fiber<void> | null = null;

	const isAlive = (containerId: string) =>
		docker.containers.inspect(containerId).pipe(
			Effect.map((info) => info.State.Running),
			Effect.catch(() => Effect.succeed(false)),
		);

	const waitUntilResponsive = (containerId: string) =>
		Effect.gen(function* () {
			const deadline = Date.now() + READY_TIMEOUT_MS;
			while (Date.now() < deadline) {
				const result = yield* docker.exec.capture(containerId, ["true"]);
				if (result.exitCode === 0) return true;
				yield* Effect.sleep(READY_POLL_MS);
			}
			return false;
		});

	/** Writes the activity marker the container's own watchdog reads; best effort. */
	const touch = (scanner: ScannerType) => {
		const state = states[scanner];
		state.lastActivityAt = Date.now();
		return state.containerId === null
			? Effect.void
			: docker.exec.capture(state.containerId, ["sh", "-c", "date +%s > /var/run/scanner/last-activity"]).pipe(Effect.asVoid);
	};

	const stop: ScannerPoolShape["stop"] = Effect.fn("ScannerPool.stop")(function* (scanner) {
		const state = states[scanner];
		if (state.idleTimer !== null) {
			const timer = state.idleTimer;
			state.idleTimer = null;
			yield* Fiber.interrupt(timer);
		}
		const containerId = state.containerId;
		state.containerId = null;
		if (containerId === null) return;
		yield* docker.containers.stop(containerId).pipe(
			Effect.matchEffect({
				onSuccess: () => Effect.logInfo(`Stopped ${scanner} shared container ${containerId}`),
				onFailure: (failure) => Effect.logWarning(`Error stopping ${scanner} container ${containerId}: ${failure.message}`),
			}),
		);
	});

	const resetIdleTimer = (scanner: ScannerType) =>
		Effect.gen(function* () {
			const state = states[scanner];
			if (state.idleTimer !== null) yield* Fiber.interrupt(state.idleTimer);
			state.idleTimer = yield* Effect.forkDetach(
				Effect.sleep(config.idleTimeoutMs).pipe(
					Effect.flatMap(() =>
						Effect.logInfo(`No ${scanner} activity for ${String(config.idleTimeoutMs / 1_000 / 60)}m — stopping shared container`),
					),
					Effect.flatMap(() => stop(scanner)),
				),
			);
		});

	const cleanStaleImages: ScannerPoolShape["cleanStaleImages"] = Effect.gen(function* () {
		const lastActivity = Math.max(...SCANNER_TYPES.map((scanner) => states[scanner].lastActivityAt));
		if (Date.now() - lastActivity < IMAGE_CLEANUP_THRESHOLD_MS) return;
		yield* Effect.logInfo("No scanner activity for 10 days — cleaning up cached scanner image layers");
		for (const scanner of SCANNER_TYPES) {
			const containerId = states[scanner].containerId;
			if (containerId === null) continue;
			yield* docker.exec.capture(containerId, [
				"sh",
				"-c",
				"rm -rf /root/.cache/trivy/* /root/.cache/grype/* 2>/dev/null; docker image prune -f 2>/dev/null || true",
			]);
		}
		yield* Effect.logInfo("Stale scanner images cleaned up");
	});

	const startCleanupTimer = Effect.gen(function* () {
		if (cleanupTimer !== null) return;
		cleanupTimer = yield* Effect.forkDetach(
			Effect.sleep(IMAGE_CLEANUP_INTERVAL_MS).pipe(Effect.flatMap(() => cleanStaleImages), Effect.forever),
		);
	});

	/** Builds the runner image once per image and process; false when it cannot be built. */
	const ensureImage = (image: string) =>
		Effect.gen(function* () {
			if (yield* docker.images.exists(image)) return true;
			let attempt = imageBuilds.get(image);
			if (attempt === undefined) {
				attempt = Effect.runPromise(
					Effect.gen(function* () {
						const context = scannerBuildContext(config);
						if (context === null) {
							yield* Effect.logWarning(
								`Scanner-runner build context "infra/docker/scanner-runner/" not found from cwd "${process.cwd()}" — ` +
									"skipping build (one attempt per process). Manual fallback: bun --bun run docker:build:scanner-runner",
							);
							return false;
						}
						yield* Effect.logInfo(`Building scanner-runner image "${image}" from ${context} (single attempt)`);
						return yield* docker.build.image(context, image, { dockerfileName: "Dockerfile" }).pipe(
							Effect.as(true),
							Effect.catch((failure) =>
								Effect.logWarning(
									`Scanner-runner image "${image}" could not be built: ${failure.message}. Scanners will use ephemeral containers as fallback.`,
								).pipe(Effect.as(false)),
							),
						);
					}),
				);
				imageBuilds.set(image, attempt);
			}
			return yield* Effect.promise(() => attempt);
		});

	/** A running container from an earlier process, if there is one; a stopped one is removed. */
	const adoptExisting = (name: string) =>
		docker.containers.inspect(name).pipe(
			Effect.flatMap((info) =>
				info.State.Running
					? Effect.succeed<string | null>(info.Id)
					: docker.containers.remove(name).pipe(Effect.as<string | null>(null)),
			),
			Effect.catch(() => Effect.succeed<string | null>(null)),
		);

	const engineEnv = (): string[] => {
		if (access.socketBind !== null) return [`DOCKER_HOST=unix://${access.socketBind.split(":")[0] ?? ""}`];
		return access.tcp ? [`DOCKER_HOST=tcp://${access.tcp.host}:${String(access.tcp.port)}`] : [];
	};

	const start = (scanner: ScannerType) =>
		Effect.gen(function* () {
			const state = states[scanner];
			const name = SCANNER_CONTAINER_NAMES[scanner];
			if (!(yield* ensureImage(config.image))) {
				if (!warnedUnavailable.has(config.image)) {
					warnedUnavailable.add(config.image);
					yield* Effect.logError(
						`Cannot start ${scanner} container — image "${config.image}" not available and build failed. ` +
							"Scanners fall back to ephemeral per-scan containers until the image exists. " +
							"Build manually with: bun --bun run docker:build:scanner-runner",
					);
				}
				return false;
			}

			const adopted = yield* adoptExisting(name);
			const containerId =
				adopted ??
				(yield* docker.containers
					.create({
						Image: config.image,
						name,
						Env: engineEnv(),
						HostConfig: { AutoRemove: true, Binds: access.socketBind === null ? [] : [access.socketBind] },
						Tty: false,
					})
					.pipe(Effect.map((created) => created.id)));
			state.containerId = containerId;
			yield* Effect.logInfo(`${adopted === null ? "Created" : "Adopted existing"} ${scanner} shared container ${containerId} (${name})`);
			// An adopted container may have been stopped between the check and now; starting it is idempotent.
			yield* docker.containers.start(containerId);
			if (!(yield* waitUntilResponsive(containerId))) {
				yield* Effect.logWarning(`${scanner} container did not become responsive in time`);
			}
			yield* touch(scanner);
			yield* resetIdleTimer(scanner);
			yield* startCleanupTimer;
			return true;
		}).pipe(
			Effect.catch((failure) => {
				states[scanner].containerId = null;
				return Effect.logError(`Failed to start ${scanner} shared container: ${failure.message}`).pipe(Effect.as(false));
			}),
		);

	const ensureRunning: ScannerPoolShape["ensureRunning"] = Effect.fn("ScannerPool.ensureRunning")(function* (scanner) {
		if (config.autoScanDisabled) {
			yield* Effect.logDebug(`Auto-scan is disabled — not starting ${scanner} container`);
			return false;
		}
		const state = states[scanner];
		if (state.containerId !== null) {
			if (yield* isAlive(state.containerId)) return true;
			yield* Effect.logWarning(`${scanner} container is no longer running — will recreate`);
			state.containerId = null;
		}
		// Concurrent callers share one start.
		state.starting ??= Effect.runPromise(start(scanner)).finally(() => {
			state.starting = null;
		});
		const starting = state.starting;
		return yield* Effect.promise(() => starting);
	});

	const exec: ScannerPoolShape["exec"] = Effect.fn("ScannerPool.exec")(function* (scanner, cmd) {
		const containerId = states[scanner].containerId;
		if (containerId === null) {
			return yield* Effect.fail(
				new DockerInvalid({ reason: `${scanner} shared container is not running — call ensureRunning("${scanner}") first` }),
			);
		}
		const startedAt = Date.now();
		yield* touch(scanner);
		const result = yield* docker.exec.capture(containerId, cmd);
		return { exitCode: result.exitCode, output: result.output, durationMs: Date.now() - startedAt };
	});

	return {
		ensureRunning,
		exec,
		stop,
		stopAll: Effect.forEach(SCANNER_TYPES, stop, { concurrency: "unbounded" }).pipe(Effect.asVoid),
		cleanStaleImages,
	};
}

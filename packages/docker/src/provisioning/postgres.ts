import { Context, Effect, Layer } from "effect";

import type { SwarmServiceSpecInput } from "@deployer/contracts-entities";

import { DockerEngine } from "../engine/docker-engine";
import { DockerUnavailable, type DockerError } from "../errors/errors";
import { platformNetworkName, platformOverlayNetworkName } from "../supervision/docker-supervisor-runtime";

/**
 * The platform's own Postgres, run as a swarm service.
 *
 * Its desired state is pure data (`buildPostgresSpec`); `PostgresProvisioner` is what makes the
 * engine match it and waits for the scheduler to start a task.
 */

export const MANAGED_POSTGRES_CONTAINER_NAME = "deployer-postgres-dev";
export const MANAGED_POSTGRES_VOLUME_NAME = "deployer_postgres_data";
export const MANAGED_POSTGRES_IMAGE = "postgres:16-alpine";
export const MANAGED_POSTGRES_PORT = 5432;
export const MANAGED_POSTGRES_ALIAS = "global-db";

const MANAGED_POSTGRES_SERVICE_BASE_NAME = "deployer-postgres";

/** The swarm service name, optionally scoped by a deployment prefix. */
export function managedPostgresServiceName(prefix?: string | null): string {
	return prefix === undefined || prefix === null || prefix === ""
		? MANAGED_POSTGRES_SERVICE_BASE_NAME
		: `${MANAGED_POSTGRES_SERVICE_BASE_NAME}-${prefix}`;
}

/** The identity the database is created with. */
export type PostgresIdentity = {
	readonly databaseName: string;
	readonly username: string;
	readonly password: string;
	readonly image: string;
};

/** The desired swarm service, with no network attached yet (see `attachPostgresOverlay`). */
export function buildPostgresSpec(input: { prefix?: string | null; identity: PostgresIdentity }): SwarmServiceSpecInput {
	const { databaseName, username, password, image } = input.identity;
	return {
		name: managedPostgresServiceName(input.prefix),
		image,
		mode: "replicated",
		replicas: 1,
		env: [`POSTGRES_DB=${databaseName}`, `POSTGRES_USER=${username}`, `POSTGRES_PASSWORD=${password}`],
		command: [],
		args: [],
		labels: { "deployer.managed": "true", "deployer.managed_reason": "global_db" },
		containerLabels: {},
		mounts: [{ type: "volume", source: MANAGED_POSTGRES_VOLUME_NAME, target: "/var/lib/postgresql/data", readOnly: false }],
		placementPreferences: [],
		placementConstraints: [],
		resourcesLimits: {},
		resourcesReservations: {},
		// No host-published port: a publish bound 0.0.0.0:5432 put the platform's state store on every
		// interface. Consumers reach it on the platform overlay by its alias; the caller attaches it.
		networks: [],
		healthcheck: {
			test: ["CMD-SHELL", `pg_isready -U ${username} -d ${databaseName}`],
			intervalMs: 5_000,
			timeoutMs: 5_000,
			retries: 12,
			startPeriodMs: 5_000,
		},
		// The data directory is exclusive, so a replacement task can never run beside the old one:
		// start-first would leave the service at 0/1 forever.
		updateConfig: { parallelism: 1, delayMs: 0, order: "stop-first", failureAction: "rollback" },
		endpointMode: "dnsrr",
		stopGracePeriodSeconds: 60,
		endpointPorts: [],
	};
}

/** Attaches the platform overlay, with the aliases consumers resolve the database by. */
export function attachPostgresOverlay(spec: SwarmServiceSpecInput, prefix?: string | null): SwarmServiceSpecInput {
	const base = platformNetworkName(prefix);
	spec.networks = [
		{
			target: platformOverlayNetworkName(base),
			aliases: [spec.name, MANAGED_POSTGRES_ALIAS, base === "" ? "deployer-platform" : base],
		},
	];
	return spec;
}

/** The scheduler rejected the service, or never started a task for it. */
export class PostgresProvisionFailed extends DockerUnavailable {}

export type PostgresProvisionerShape = {
	/** The overlay network the database lives on, created if needed. */
	readonly ensureOverlay: (prefix?: string | null) => Effect.Effect<string, DockerError>;
	/**
	 * Brings the service up to date and waits until a task is running. Fails when the scheduler
	 * rejects it or no task runs within `waitAttempts` checks (default 30, `waitIntervalMs` apart,
	 * default 2000).
	 */
	readonly ensure: (input: {
		prefix?: string | null;
		identity: PostgresIdentity;
		waitAttempts?: number;
		waitIntervalMs?: number;
	}) => Effect.Effect<SwarmServiceSpecInput, DockerError>;
	readonly remove: (prefix?: string | null) => Effect.Effect<void, DockerError>;
};

export class PostgresProvisioner extends Context.Service<PostgresProvisioner, PostgresProvisionerShape>()(
	"docker/PostgresProvisioner",
) {
	static readonly Live: Layer.Layer<PostgresProvisioner, never, DockerEngine> = Layer.effect(
		PostgresProvisioner,
		Effect.gen(function* () {
			return makePostgresProvisioner(yield* DockerEngine);
		}),
	);
}

export function makePostgresProvisioner(docker: {
	readonly swarmServices: Pick<DockerEngine["Service"]["swarmServices"], "reconcile" | "listTasks" | "remove">;
	readonly networks: Pick<DockerEngine["Service"]["networks"], "ensureOverlay">;
}): PostgresProvisionerShape {
	const ensureOverlay: PostgresProvisionerShape["ensureOverlay"] = Effect.fn("PostgresProvisioner.ensureOverlay")(function* (prefix) {
		const overlay = platformOverlayNetworkName(platformNetworkName(prefix));
		yield* docker.networks.ensureOverlay({
			name: overlay,
			driver: "overlay",
			attachable: true,
			ingress: false,
			labels: { "deployer.managed": "true", "deployer.platform": "true" },
			enableIpv6: false,
		});
		return overlay;
	});

	const waitForRunningTask = (name: string, attempts: number, intervalMs: number) =>
		Effect.gen(function* () {
			for (let attempt = 1; attempt <= attempts; attempt++) {
				const tasks = yield* docker.swarmServices.listTasks(name).pipe(Effect.catch(() => Effect.succeed([])));
				if (tasks.some((task) => task.Status.State === "running")) return;
				const rejected = tasks.find((task) => task.Status.State === "rejected");
				if (rejected !== undefined) {
					return yield* Effect.fail(
						new PostgresProvisionFailed({
							reason: `Global Postgres swarm service "${name}" was rejected by the scheduler: ${rejected.Status.Err ?? "no reason reported"}`,
						}),
					);
				}
				yield* Effect.sleep(intervalMs);
			}
			return yield* Effect.fail(
				new PostgresProvisionFailed({
					reason: `Global Postgres swarm service "${name}" has no running task after ${String(attempts)} attempts`,
				}),
			);
		});

	return {
		ensureOverlay,
		ensure: Effect.fn("PostgresProvisioner.ensure")(function* (input) {
			const spec = attachPostgresOverlay(buildPostgresSpec(input), input.prefix);
			yield* ensureOverlay(input.prefix);
			yield* docker.swarmServices.reconcile(spec, 1);
			yield* waitForRunningTask(spec.name, input.waitAttempts ?? 30, input.waitIntervalMs ?? 2_000);
			return spec;
		}),
		remove: (prefix) => docker.swarmServices.remove(managedPostgresServiceName(prefix)),
	};
}

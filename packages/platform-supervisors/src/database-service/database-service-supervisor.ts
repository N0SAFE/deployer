/**
 * The DATABASE SERVICE primitive: a SCALED set of managed Postgres instances.
 *
 * The instance list comes from `MANAGED_DATABASE_INSTANCES` ("db-a,db-b") and is asked on every pass,
 * so instances come and go: a new key gets a child supervisor, a key that disappears has its service
 * removed (its data volume stays). Children are converged in parallel and probed into one aggregate.
 *
 * External management: `MANAGED_DATABASE_ENABLED=true` means the deployment (compose/operator) owns
 * the instance containers, so the host does not register this supervisor.
 */
import { Effect } from "effect";

import type { DockerEngineShape, DockerError } from "@deployer/docker";
import { makeSupervisor, type ProbeResult, type Supervisor, type SupervisorSpec } from "@deployer/supervision";

import { makeDatabaseInstance, type DatabaseInstanceConfig } from "./database-instance";
import {
	DATABASE_SERVICE_SUPERVISOR_ID,
	databaseServicePayloadSchema,
	databaseServiceProcessInfoSchema,
	type DatabaseInstancePayload,
	type DatabaseInstanceProcessInfo,
	type DatabaseServicePayload,
} from "./schemas";

export type DatabaseServiceConfig = DatabaseInstanceConfig & {
	/** The instances wanted right now, in order, without duplicates. */
	readonly instances: () => readonly string[];
};

export type DatabaseServiceDeps = {
	readonly engine: DockerEngineShape;
	readonly config: DatabaseServiceConfig;
	readonly logger: { readonly log: (message: string) => void };
};

export type DatabaseServiceSupervisor = {
	readonly spec: SupervisorSpec<typeof databaseServicePayloadSchema, typeof databaseServiceProcessInfoSchema>;
};

type Child = {
	readonly supervisor: Supervisor<DatabaseInstancePayload, DatabaseInstanceProcessInfo>;
	readonly remove: Effect.Effect<void, DockerError>;
};

export function makeDatabaseServiceSupervisor({ engine, config, logger }: DatabaseServiceDeps): DatabaseServiceSupervisor {
	/** One child per instance, kept across passes so each one's state survives. */
	const children = new Map<string, Child>();
	/** The keys the last convergence acted on, for the aggregate probe and for detecting a scale-down. */
	let activeKeys: readonly string[] = [];

	const childFor = (key: string): Child => {
		const existing = children.get(key);
		if (existing !== undefined) return existing;
		const instance = makeDatabaseInstance(engine, config, key);
		const child: Child = { supervisor: makeSupervisor(instance.spec, { label: `database-instance:${key}` }), remove: instance.remove };
		children.set(key, child);
		return child;
	};

	const converge: Effect.Effect<void, unknown> = Effect.gen(function* () {
		const desired = config.instances();
		// Scale down: an instance no longer wanted loses its service (the data volume persists).
		for (const key of activeKeys.filter((previous) => !desired.includes(previous))) {
			logger.log(`Database instance '${key}' scaled down — removing`);
			yield* childFor(key).remove.pipe(Effect.ignore);
			children.delete(key);
		}
		activeKeys = desired;
		// Each child records its own outcome (`ensureDesiredState` never fails), so one broken instance
		// never stops the others.
		yield* Effect.forEach(desired, (key) => childFor(key).supervisor.ensureDesiredState, { concurrency: "unbounded", discard: true });
	});

	const probe: Effect.Effect<ProbeResult<DatabaseServicePayload>> = Effect.gen(function* () {
		const startedAt = Date.now();
		const snapshots = yield* Effect.forEach(activeKeys, (key) => childFor(key).supervisor.getHealthAndNotify, { concurrency: "unbounded" });
		const payloads = snapshots.map((snapshot) => snapshot.payload);
		const allHealthy = payloads.length > 0 && payloads.every((payload) => (payload.service?.runningTasks ?? 0) > 0);
		return {
			healthy: allHealthy,
			...(allHealthy ? {} : { detail: "one or more database instances not running" }),
			payload: {
				checkedAt: new Date().toISOString(),
				latencyMs: Date.now() - startedAt,
				instances: [...config.instances()],
				children: payloads,
			},
		};
	});

	const spec: DatabaseServiceSupervisor["spec"] = {
		id: DATABASE_SERVICE_SUPERVISOR_ID,
		description: "Database service primitive (scaled managed Postgres instances, reachable by alias over the private mesh)",
		payloadSchema: databaseServicePayloadSchema,
		processInfoSchema: databaseServiceProcessInfoSchema,
		converge,
		probe,
		degradedPayload: () => ({ checkedAt: new Date().toISOString(), latencyMs: 0, instances: [...config.instances()], children: [] }),
		processInfo: Effect.suspend(() => {
			const instances = [...config.instances()];
			return Effect.forEach(instances, (key) => childFor(key).supervisor.getProcessInfo, { concurrency: "unbounded" }).pipe(
				Effect.map((childInfos) => ({ instances, children: childInfos })),
			);
		}),
	};

	return { spec };
}


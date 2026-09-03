/**
 * supervisor-process-info.ts — shared, Zod-validated process-info schemas.
 *
 * "Process info" is how a supervised process tells consumers EVERYTHING about
 * itself: what kind of process it is (a docker container, a local sqlite
 * database, …), its desired config (image, ports, labels, binds) and its live
 * state (running, container id, restart count) — plus supervisor-specific
 * reachability (entry port, URLs, connection strings).
 *
 * Consumers resolve a supervisor through the orchestrator and ask for process
 * info directly:
 *
 *   const traefik = await orch.getSupervisor(TraefikSupervisorService);
 *   const info = traefik && (await traefik.getProcessInfo());
 *   // info.process.kind === "docker"; info.urls.entryUrl; info.entry.port
 *
 * Every supervisor declares its own `processInfoSchema` (the SSOT for what it
 * reports) by extending `baseSupervisorProcessInfoSchema` with a process
 * flavor (`dockerProcessInfoSchema`, `sqliteProcessInfoSchema`, …) plus its
 * own fields. `getProcessInfo()` validates the merged result at runtime — Zod
 * is the source of truth, mirrors the payload pattern.
 */

import z from "zod/v4";

/** Shared base fields every supervisor's process info carries. */
export const baseSupervisorProcessInfoSchema = z.object({
	/** Stable orchestrator registry id (the class identifier). */
	supervisorId: z.string(),
	/** Human description of the supervised resource. */
	description: z.string(),
	/** Last convergence lifecycle state. */
	state: z.enum(["idle", "converging", "converged", "degraded"]),
	/** Real health (result of the latest probe, see getHealth). */
	healthy: z.boolean(),
	/** Convergence/probe detail (degradation reason, …). */
	detail: z.string().nullable(),
	/** Non-fatal warnings the operator must act on. */
	warnings: z.array(z.string()),
	/** ISO 8601 timestamp of the health probe backing this info. */
	checkedAt: z.string().datetime(),
});
export type BaseSupervisorProcessInfo = z.infer<typeof baseSupervisorProcessInfoSchema>;

/** Desired config + live runtime view of a docker-backed supervised process. */
export const dockerProcessInfoSchema = z.object({
	kind: z.literal("docker"),
	/** What the supervisor WANTS running (never nullable — the spec always
	 *  exists; the container may simply not be running yet). */
	desired: z.object({
		name: z.string(),
		image: z.string(),
		command: z.array(z.string()).nullable(),
		labels: z.record(z.string(), z.string()),
		networkName: z.string().nullable(),
		binds: z.array(z.string()).nullable(),
		hostPorts: z
			.array(z.object({ containerPort: z.number().int().min(1), hostPort: z.number().int().min(1) }))
			.nullable(),
		restartPolicy: z.string(),
	}),
	/** What is ACTUALLY running right now (all-null when the container doesn't
	 *  exist). Nullable fields = measurement could not be obtained. */
	live: z.object({
		containerId: z.string().nullable(),
		running: z.boolean().nullable(),
		startedAt: z.string().datetime().nullable(),
		exitCode: z.number().int().nullable(),
		restartCount: z.number().int().min(0).nullable(),
	}),
});
export type DockerProcessInfo = z.infer<typeof dockerProcessInfoSchema>;

/** A supervised process backed by a local sqlite database file. */
export const sqliteProcessInfoSchema = z.object({
	kind: z.literal("sqlite"),
	dbPath: z.string(),
	journalMode: z.string(),
	tableCount: z.number().int().min(0),
	migrationsApplied: z.number().int().min(0),
	fileSizeBytes: z.number().int().min(0).nullable(),
});
export type SqliteProcessInfo = z.infer<typeof sqliteProcessInfoSchema>;
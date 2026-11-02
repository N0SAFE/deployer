/**
 * ClusterSettings — the cluster-wide key/value store, as the API reads it.
 *
 * The settings live in the mesh roster: every agent holds all of them, any member
 * may write one, and gossip converges them. That makes them the right home for
 * every fact that belongs to the CLUSTER rather than to the node the API happens
 * to run on (ingress lanes, the public edge's state, node doors) — the API is a
 * replicated swarm service and can be rescheduled anywhere.
 *
 * The store is reached through this node's agent node door, served on a local
 * socket, so a read never leaves the machine. Every plane that keeps cluster state
 * goes through here, so the parsing, the caller's default and validation are
 * written once:
 *
 *   - no agent, or an agent in no cluster yet, reads as the caller's default —
 *     and writes FAIL: an operator's choice is never silently dropped.
 */

import { Injectable, Logger } from "@nestjs/common";

import type { NodeDoorClient } from "@deployer/mesh-client";

import type z from "zod/v4";

@Injectable()
export class ClusterSettings {
	private readonly logger = new Logger(ClusterSettings.name);

	constructor(private readonly door: NodeDoorClient) {}

	/** Whether the cluster store is reachable at all (an agent in a cluster). */
	async available(): Promise<boolean> {
		return (await this.door.settings()) !== null;
	}

	/** Every setting, decoded. A value that is not JSON is skipped and logged. */
	async readAll(): Promise<Record<string, unknown>> {
		const settings: Record<string, unknown> = {};
		for (const setting of (await this.door.settings()) ?? []) {
			try {
				settings[setting.key] = JSON.parse(setting.value) as unknown;
			} catch (error: unknown) {
				this.logger.warn(
					`Ignoring malformed cluster setting ${setting.key}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		return settings;
	}

	/**
	 * One setting, validated when a schema is given. `fallback` when it is unset,
	 * when there is no cluster yet, or when the stored value does not match `schema`
	 * (logged — a malformed value must not take a plane down).
	 */
	async read<T>(key: string, schema: z.ZodType<T> | null, fallback: T): Promise<T> {
		const raw = (await this.readAll())[key];
		if (raw === undefined) return fallback;
		if (schema === null) return raw as T;
		const parsed = schema.safeParse(raw);
		if (parsed.success) return parsed.data;
		this.logger.error(`Ignoring malformed cluster setting ${key}: ${parsed.error.message}`);
		return fallback;
	}

	/** Write one setting. Throws when there is no agent to write to, so a choice is never dropped. */
	async write(key: string, value: unknown): Promise<void> {
		const written = await this.door.writeSetting(key, value);
		if (written === null) throw new Error(`no mesh agent on this node — cluster setting ${key} was not written`);
	}
}

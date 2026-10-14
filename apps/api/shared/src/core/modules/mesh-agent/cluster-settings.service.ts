/**
 * ClusterSettingsService — the cluster-wide key/value store, as the API reads it.
 *
 * The settings live in the mesh roster: every agent holds all of them, any member
 * may write one, and gossip converges them. That makes them the right home for
 * every fact that belongs to the CLUSTER rather than to the node the API happens
 * to run on (ingress lanes, the public edge's state, node doors) — the API is a
 * replicated swarm service and can be rescheduled anywhere.
 *
 * Every plane that keeps cluster state goes through here, so the read cache, the
 * "no agent yet" fallback and validation are written once:
 *
 *   - reads are cached for a moment (Traefik polls every node every few seconds);
 *   - with no agent, or an agent in no cluster yet, reads return `undefined` —
 *     the caller's default applies — and writes FAIL: an operator's choice is
 *     never silently dropped.
 */

import { Injectable, Logger } from "@nestjs/common";
import type { JsonValue } from "@repo/mesh-network";
import type z from "zod/v4";

import { MeshAgentClient, MeshAgentRequestError, MeshAgentUnavailableError } from "./mesh-agent.client";

/** How long a settings read is reused. */
const READ_CACHE_MS = 2_000;

@Injectable()
export class ClusterSettingsService {
	private readonly logger = new Logger(ClusterSettingsService.name);
	private cache: { at: number; settings: Record<string, unknown> | null } | null = null;
	private warnedUnavailable = false;

	constructor(private readonly mesh: MeshAgentClient) {}

	/** All settings, or null when there is no agent / no cluster yet. */
	async readAll(): Promise<Record<string, unknown> | null> {
		if (this.cache !== null && Date.now() - this.cache.at < READ_CACHE_MS) return this.cache.settings;
		let settings: Record<string, unknown> | null;
		try {
			settings = await this.mesh.readSettings();
			this.warnedUnavailable = false;
		} catch (error) {
			const benign =
				error instanceof MeshAgentUnavailableError || (error instanceof MeshAgentRequestError && error.agentCode === "not-in-cluster");
			if (!benign) throw error;
			if (!this.warnedUnavailable) {
				this.logger.warn(`Cluster settings unavailable (${error.message}) — every plane reads its default`);
				this.warnedUnavailable = true;
			}
			settings = null;
		}
		this.cache = { at: Date.now(), settings };
		return settings;
	}

	/**
	 * One setting, validated. `undefined` when it is unset, when there is no cluster
	 * yet, or when the stored value does not match `schema` (logged — a malformed
	 * value must not take a plane down; the caller's default applies instead).
	 */
	async read<T extends z.ZodType>(key: string, schema: T): Promise<z.output<T> | undefined> {
		const raw = (await this.readAll())?.[key];
		if (raw === undefined) return undefined;
		const parsed = schema.safeParse(raw);
		if (parsed.success) return parsed.data;
		this.logger.error(`Ignoring malformed cluster setting ${key}: ${parsed.error.message}`);
		return undefined;
	}

	/** Whether the cluster store is reachable at all (an agent in a cluster). */
	async available(): Promise<boolean> {
		return (await this.readAll()) !== null;
	}

	/** Write one setting, validated by `schema`. Throws when there is no cluster to write to. */
	async write<T extends z.ZodType>(key: string, schema: T, value: z.input<T>): Promise<z.output<T>> {
		const parsed = schema.parse(value);
		await this.mesh.writeSetting(key, parsed as JsonValue);
		this.cache = null;
		return parsed;
	}
}

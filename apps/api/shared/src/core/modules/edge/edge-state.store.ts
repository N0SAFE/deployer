/**
 * EdgeStateStore — where an edge provider keeps what it created (tunnel ids,
 * credentials…), replicated to every member.
 *
 * One cluster setting per provider (`edge.<provider id>`), validated by the
 * provider's own schema, so providers never collide and never need a migration
 * of someone else's shape.
 *
 * Credentials stored here (a connector token) replicate to every member: a
 * connector may be scheduled on any node, and members are admitted,
 * WireGuard-encrypted peers — the same trust boundary as the cluster itself. They
 * NEVER travel to a client: providers report `EdgeStatus` facts, not their state.
 */

import { Injectable } from "@nestjs/common";
import z from "zod/v4";

import { ClusterSettingsService } from "../mesh-agent/cluster-settings.service";

export function edgeStateKey(providerId: string): string {
	return `edge.${providerId}`;
}

@Injectable()
export class EdgeStateStore {
	constructor(private readonly settings: ClusterSettingsService) {}

	/** The provider's state, or null when it has none (never provisioned, torn down, malformed). */
	async read<T extends z.ZodType>(providerId: string, schema: T): Promise<z.output<T> | null> {
		return (await this.settings.read(edgeStateKey(providerId), schema.nullable())) ?? null;
	}

	async write<T extends z.ZodType>(providerId: string, schema: T, value: z.input<T>): Promise<z.output<T>> {
		return await this.settings.write(edgeStateKey(providerId), schema, value);
	}

	/** Forget the provider's state. Written as `null` so the removal replicates like any write. */
	async clear(providerId: string): Promise<void> {
		await this.settings.write(edgeStateKey(providerId), z.null(), null);
	}
}

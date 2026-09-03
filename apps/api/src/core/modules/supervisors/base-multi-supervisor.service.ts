/**
 * BaseMultiSupervisorService — base for supervisors that supervise ONE OR MORE
 * instances of the same resource.
 *
 * A multi supervisor manages a set of child supervisors, one per instance
 * key. Each child is a `BaseSupervisorService` whose identifier is derived
 * from the shared class static + its instance key:
 *
 *   ChildKind.getIdentifier({ <keyField>: key })   // e.g. multi:acme:ab12cd34
 *
 * The multi base owns the lifecycle:
 *   - reconciliation enumerates the desired instance keys, builds a child per
 *     key and converges each in parallel (each child remains independently
 *     registered in the orchestrator at `supervisorId`),
 *   - probes aggregate the children's health into one snapshot.
 *
 * Concrete multi supervisors implement:
 *   - `enumerateInstanceKeys()`  — the currently-desired keys
 *   - `buildInstance(key)`       — construct the child supervisor for a key
 *   - the shared `payloadSchema` for the AGGREGATED payload, plus
 *     `reconcile`/`probe` via `runReconcileChildren` / `runProbeChildren`.
 */

import z from "zod/v4";

import {
	BaseSupervisorService,
	baseSupervisorPayloadSchema,
	type SupervisorProbeResult,
} from "./base-supervisor.service";

/** Minimal contract every child supervisor must satisfy. */
export type AnyChildSupervisor = BaseSupervisorService<z.ZodType>;

export abstract class BaseMultiSupervisorService<
	TKey,
	TSchema extends z.ZodType = typeof baseSupervisorPayloadSchema,
> extends BaseSupervisorService<TSchema> {
	/** Keys active on the most recent reconcile (for aggregate probes). */
	protected activeKeys: TKey[] = [];

	/** Extend the aggregated payload with per-instance health entries. */
	abstract readonly childrenPayloadSchema: TSchema;

	/**
	 * Enumerate the currently-required instance keys. Called every reconcile,
	 * so instances can appear/disappear as configuration changes.
	 */
	protected abstract enumerateInstanceKeys(): TKey[] | Promise<TKey[]>;

	/** Build (or rebuild) the child supervisor for a given instance key. */
	protected abstract buildInstance(key: TKey): AnyChildSupervisor;

	/**
	 /** Reconcile every desired instance in parallel. Children not on the
	 * desired list are left untouched (their removal is the subclass's
	 * responsibility via `removeStaleChildren` after this call if needed).
	 */
	protected async runReconcileChildren(): Promise<void> {
		const keys = await this.enumerateInstanceKeys();
		this.activeKeys = keys;
		await Promise.all(keys.map(async (key) => this.buildInstance(key).ensureDesiredState()));
	}

	/** Aggregate the children's latest health SNAPSHOTS (typed per child). */
	protected async runProbeChildren(): Promise<Array<ReturnType<AnyChildSupervisor["getHealth"]> extends Promise<infer S> ? S : never>> {
		const keys = this.activeKeys;
		const snapshots = await Promise.all(keys.map((key) => this.buildInstance(key).getHealthAndNotify()));
		return snapshots as Array<ReturnType<AnyChildSupervisor["getHealth"]> extends Promise<infer S> ? S : never>;
	}

	/** Remove children whose key is no longer in the desired set. */
	protected removeStaleChildren(desired: TKey[], existingKeys: TKey[], removeKey: (key: TKey) => void): void {
		for (const key of existingKeys) {
			if (!desired.includes(key)) removeKey(key);
		}
	}
}
import type z from "zod/v4";
import type { baseSupervisorPayloadSchema } from "@deployer/supervision";

import { BaseSupervisorService } from "./base-supervisor.service";

/** Minimal contract every child supervisor satisfies. */
export type AnyChildSupervisor = BaseSupervisorService<z.ZodType>;

/**
 * A supervisor over one or more instances of the same resource: one child supervisor per instance
 * key, each independently registered, converged in parallel, and probed into one aggregate.
 *
 * Subclasses say which keys are wanted (`enumerateInstanceKeys`) and how to build a child for one
 * (`buildInstance`), then drive them with `runReconcileChildren` / `runProbeChildren`.
 */
export abstract class BaseMultiSupervisorService<
	TKey,
	TSchema extends z.ZodType = typeof baseSupervisorPayloadSchema,
> extends BaseSupervisorService<TSchema> {
	/** Keys active on the most recent reconcile, for aggregate probes. */
	protected activeKeys: TKey[] = [];

	abstract readonly childrenPayloadSchema: TSchema;

	/** The instance keys wanted right now; asked on every reconcile, so instances can come and go. */
	protected abstract enumerateInstanceKeys(): TKey[] | Promise<TKey[]>;

	protected abstract buildInstance(key: TKey): AnyChildSupervisor;

	/** Converges every wanted instance in parallel. Children no longer wanted are left to the subclass to remove. */
	protected async runReconcileChildren(): Promise<void> {
		const keys = await this.enumerateInstanceKeys();
		this.activeKeys = keys;
		await Promise.all(keys.map((key) => this.buildInstance(key).ensureDesiredState()));
	}

	/** The children's latest health snapshots. */
	protected async runProbeChildren() {
		return Promise.all(this.activeKeys.map((key) => this.buildInstance(key).getHealthAndNotify()));
	}

	/** Calls `removeKey` for every existing key that is no longer wanted. */
	protected removeStaleChildren(desired: TKey[], existingKeys: TKey[], removeKey: (key: TKey) => void): void {
		for (const key of existingKeys) {
			if (!desired.includes(key)) removeKey(key);
		}
	}
}

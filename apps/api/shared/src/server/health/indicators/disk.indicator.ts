import { statfs } from "node:fs/promises";

import { Context, Effect } from "effect";

import { indicatorFor, type HealthIndicatorShape } from "./indicator-result";

import type { IndicatorResult } from "../types";

/** Reported down below this free-space ratio. */
const MIN_FREE_RATIO = 0.05;

/**
 * Disk space on the volume this service writes to — a REAL `statfs`.
 *
 * ── WHY THIS MATTERS IN THIS PLATFORM SPECIFICALLY ──────────────────────────
 * Services here write persistent data: the local SQLite `node_config`, uploads,
 * deployment build contexts, container layers. A node that fills its disk
 * fails in the worst possible way — SQLite writes start erroring mid-transaction
 * and Docker cannot pull or create anything — and the symptom (`disk full`)
 * appears far from the cause. A node with 2% free is a problem to fix BEFORE it
 * is an outage.
 *
 * ── WHY THE RATIO AND NOT FREE BYTES ────────────────────────────────────────
 * "5 GB free" is fine on a 20 GB volumes and alarming on a 20 TB one. The ratio
 * is the comparable number, so that is what the threshold uses; the absolute
 * figures are reported as detail for the operator.
 */
export class DiskHealthIndicator extends Context.Service<DiskHealthIndicator, HealthIndicatorShape>()(
	"shared/health/DiskHealthIndicator",
) {
	static readonly NAME = "disk";

	static readonly live = class DiskHealthIndicatorImpl implements HealthIndicatorShape {
		/** `path` is where this service persists — not necessarily `/`. */
		check(path = "/"): Effect.Effect<IndicatorResult> {
			const name = DiskHealthIndicator.NAME;
			return Effect.gen(function* () {
				const check = indicatorFor(name);

				const stats = yield* Effect.result(Effect.tryPromise({ try: () => statfs(path), catch: (error) => error }));

				// An unreadable path is reported as down: a service that cannot stat its
				// own data volume cannot write to it either, and that is not "unknown".
				if (stats._tag === "Failure") {
					const cause: unknown = stats.failure;
					return check.down({
						message: cause instanceof Error ? cause.message : String(cause),
						path,
					});
				}

				const { blocks, bsize, bavail } = stats.success;
				const totalBytes = blocks * bsize;
				const freeBytes = bavail * bsize;
				const freeRatio = totalBytes === 0 ? 0 : freeBytes / totalBytes;

				const detail = {
					path,
					totalGb: bytesToGb(totalBytes),
					freeGb: bytesToGb(freeBytes),
					freeRatio: Number(freeRatio.toFixed(3)),
				};

				if (freeRatio < MIN_FREE_RATIO) {
					return check.down({
						message: `only ${String(Math.round(freeRatio * 100))}% free on ${path}`,
						...detail,
					});
				}
				return check.up(detail);
			});
		}
	};
}

function bytesToGb(bytes: number): number {
	return Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10;
}

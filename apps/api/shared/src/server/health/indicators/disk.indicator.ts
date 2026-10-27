import { Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";
import { statfs } from "node:fs/promises";

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
@Injectable()
export class DiskHealthIndicator {
	constructor(private readonly indicator: HealthIndicatorService) {}

	static readonly NAME = "disk";

	/** `path` is where this service persists — not necessarily `/`. */
	async check(path = "/"): Promise<IndicatorResult> {
		const check = this.indicator.check(DiskHealthIndicator.NAME);

		try {
			const stats = await statfs(path);

			const totalBytes = stats.blocks * stats.bsize;
			const freeBytes = stats.bavail * stats.bsize;
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
		} catch (error: unknown) {
			// An unreadable path is reported as down: a service that cannot stat its
			// own data volume cannot write to it either, and that is not "unknown".
			return check.down({
				message: error instanceof Error ? error.message : String(error),
				path,
			});
		}
	}
}

function bytesToGb(bytes: number): number {
	return Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10;
}

import { Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";
import { readFile } from "node:fs/promises";

import type { IndicatorResult } from "../types";

/** Heap is reported down above this ratio. */
const HEAP_DOWN_RATIO = 0.95;

/**
 * Process memory — a REAL reading, with a threshold that means something.
 *
 * ── WHY HEAP RATIO AND NOT ABSOLUTE BYTES ───────────────────────────────────
 * "2 GB used" is neither a problem nor a verdict — it depends on the ceiling.
 * The ratio of used to total heap is what predicts an OOM, and it stays
 * meaningful when a container's memory limit changes.
 *
 * The ceiling is read from the cgroup when one exists, because
 * `process.memoryUsage().heapTotal` is V8's heap, not the container's limit: a
 * process can sit at 40% of V8's heap and 99% of its cgroup budget. Where no
 * cgroup is readable (a developer's machine) the V8 figure is reported and the
 * check stays informational rather than inventing a limit.
 *
 * `rss` is reported alongside, because RSS growing while the heap does not is a
 * real and different failure (off-heap buffers, native leaks).
 */
@Injectable()
export class MemoryHealthIndicator {
	constructor(private readonly indicator: HealthIndicatorService) {}

	static readonly NAME = "memory";

	async check(): Promise<IndicatorResult> {
		const check = this.indicator.check(MemoryHealthIndicator.NAME);

		const usage = process.memoryUsage();
		const ratio = usage.heapTotal === 0 ? 0 : usage.heapUsed / usage.heapTotal;
		const containerLimit = await readCgroupLimitBytes();

		const detail = {
			heapUsedMb: bytesToMb(usage.heapUsed),
			heapTotalMb: bytesToMb(usage.heapTotal),
			rssMb: bytesToMb(usage.rss),
			heapRatio: Number(ratio.toFixed(3)),
			...(containerLimit === undefined
				? {}
				: {
						containerLimitMb: bytesToMb(containerLimit),
						containerRatio: Number((usage.rss / containerLimit).toFixed(3)),
					}),
		};

		// Down only when the process is genuinely about to fail. Everything else is
		// detail: a probe that turns red at 80% heap produces alerts nobody can act
		// on, and then gets ignored at the moment it matters.
		if (ratio >= HEAP_DOWN_RATIO) {
			return check.down({
				message: `heap is at ${String(Math.round(ratio * 100))}% — out of memory imminent`,
				...detail,
			});
		}
		return check.up(detail);
	}
}

/**
 * The container's memory ceiling, when this process runs in one.
 *
 * Two cgroup layouts are read because the platform runs on Docker 27 (cgroup v2,
 * `memory.max`) while older hosts use v1 (`memory/memory.limit_in_bytes`); a
 * single-path read silently reports "no limit" on half the machines.
 */
async function readCgroupLimitBytes(): Promise<number | undefined> {
	const candidates = [
		"/sys/fs/cgroup/memory.max", // cgroup v2
		"/sys/fs/cgroup/memory/memory.limit_in_bytes", // cgroup v1
	];

	for (const path of candidates) {
		let raw: string;
		try {
			raw = await readFile(path, "utf8");
		} catch {
			continue;
		}

		const value = Number(raw.trim());
		// cgroup v1 uses a huge sentinel for "no limit" — treat it as absent rather
		// than reporting a nine-exabyte ceiling.
		if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) continue;
		return value;
	}
	return undefined;
}

function bytesToMb(bytes: number): number {
	return Math.round(bytes / 1024 / 1024);
}

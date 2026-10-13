import { describe, expect, it } from "vitest";

import { analyticsRules } from "./analytics.entity";

/**
 * The analytics domain's rules.
 *
 * ── WHAT IS WORTH PINNING HERE ──────────────────────────────────────────────
 * The bucket arithmetic (a series must line up with the window it claims) and the
 * `dataSource` honesty rule. The first is silent when wrong — a chart simply shows
 * points in the wrong place. The second is the reason this domain exists in the shape it
 * does, so a regression there would be a product decision made by accident.
 */
describe("analyticsRules", () => {
	describe("bucketPlan", () => {
		it("covers the requested window", () => {
			const now = new Date("2026-10-10T12:00:00.000Z");
			const plan = analyticsRules.bucketPlan("1d", "hour", now);

			expect(plan.end.getTime()).toBe(now.getTime());
			// The window is `timeRange` long, ending at now.
			expect(plan.end.getTime() - plan.start.getTime()).toBe(24 * 60 * 60 * 1000);
			expect(plan.bucketMs).toBe(60 * 60 * 1000);
			expect(plan.bucketCount).toBe(24);
		});

		it("scales the bucket count with the granularity", () => {
			const now = new Date("2026-10-10T12:00:00.000Z");
			expect(analyticsRules.bucketPlan("1d", "minute", now).bucketCount).toBe(200);
			expect(analyticsRules.bucketPlan("30d", "day", now).bucketCount).toBe(30);
		});

		it("CAPS the bucket count so a wide range cannot produce an unrenderable series", () => {
			// `1y` at `minute` is ~525,600 points. Those are not "a bigger response" — they
			// are a response no chart can render and a worker would spend real time
			// serialising. The cap makes the worst case a fixed amount of work.
			const now = new Date("2026-10-10T12:00:00.000Z");
			const plan = analyticsRules.bucketPlan("1y", "minute", now);

			expect(plan.bucketCount).toBe(200);
			// The window is unchanged — the buckets are coarser than requested, not
			// truncated, so the series still covers what it claims to.
			expect(plan.end.getTime() - plan.start.getTime()).toBe(365 * 24 * 60 * 60 * 1000);
		});

		it("never returns zero buckets, which would be indistinguishable from no data", () => {
			const now = new Date("2026-10-10T12:00:00.000Z");
			expect(analyticsRules.bucketPlan("1h", "day", now).bucketCount).toBeGreaterThanOrEqual(1);
		});

		it("falls back to declared defaults for an unrecognised range or granularity", () => {
			// The input schema narrows these to an enum, so a value reaching here
			// unrecognised is a programming error — and turning a metrics endpoint into an
			// outage over it would be the worse failure.
			const now = new Date("2026-10-10T12:00:00.000Z");
			const plan = analyticsRules.bucketPlan("nonsense", "nonsense", now);

			expect(plan.bucketMs).toBe(60 * 60 * 1000);
			expect(plan.bucketCount).toBe(24);
		});
	});

	describe("bucketIndex", () => {
		const now = new Date("2026-10-10T12:00:00.000Z");
		const plan = analyticsRules.bucketPlan("1d", "hour", now);

		it("places a timestamp in the bucket it falls into", () => {
			// start is 24h before now; three hours in is bucket 3.
			const threeHoursIn = new Date(plan.start.getTime() + 3 * plan.bucketMs);
			expect(analyticsRules.bucketIndex(threeHoursIn, plan)).toBe(3);
		});

		it("CLAMPS a timestamp before the window to the first bucket", () => {
			// A row can legitimately fall outside: the window is computed at request time and
			// the query runs afterwards. Returning -1 would make a caller either drop a real
			// deployment from a count or index out of bounds.
			const before = new Date(plan.start.getTime() - 60 * 60 * 1000);
			expect(analyticsRules.bucketIndex(before, plan)).toBe(0);
		});

		it("CLAMPS a timestamp after the window to the last bucket", () => {
			const after = new Date(plan.end.getTime() + 60 * 60 * 1000);
			expect(analyticsRules.bucketIndex(after, plan)).toBe(plan.bucketCount - 1);
		});

		it("never returns an index outside the series", () => {
			const indexes = [
				analyticsRules.bucketIndex(new Date(0), plan),
				analyticsRules.bucketIndex(plan.start, plan),
				analyticsRules.bucketIndex(plan.end, plan),
				analyticsRules.bucketIndex(new Date(8_000_000_000_000), plan),
			];
			for (const index of indexes) {
				expect(index).toBeGreaterThanOrEqual(0);
				expect(index).toBeLessThan(plan.bucketCount);
			}
		});
	});

	describe("rollingAverage", () => {
		it("returns the first value as the average of one", () => {
			expect(analyticsRules.rollingAverage(0, 0, 1000)).toBe(1000);
		});

		it("computes the true mean incrementally", () => {
			// 100, then 200 -> 150, then 300 -> 200. An implementation that averaged the
			// running value against the next one would drift upward instead.
			const first = analyticsRules.rollingAverage(0, 0, 100);
			const second = analyticsRules.rollingAverage(first, 1, 200);
			const third = analyticsRules.rollingAverage(second, 2, 300);

			expect(second).toBe(150);
			expect(third).toBe(200);
		});

		it("does not need the samples to be retained", () => {
			// The deployments are streamed into buckets one at a time, so the count of prior
			// samples is the only available state — this is exact, not approximate.
			let average = 0;
			const values = [10, 20, 30, 40, 50];
			values.forEach((value, index) => {
				average = analyticsRules.rollingAverage(average, index, value);
			});
			expect(average).toBe(30);
		});
	});

	describe("deploymentDurationMs", () => {
		it("measures a finished deployment", () => {
			const created = new Date("2026-10-10T10:00:00Z");
			const completed = new Date("2026-10-10T10:02:30Z");
			expect(analyticsRules.deploymentDurationMs(created, completed)).toBe(150_000);
		});

		it("returns 0 for an unfinished deployment rather than a partial duration", () => {
			// Callers EXCLUDE zeros before averaging, so an in-flight deployment contributes
			// nothing instead of dragging the mean toward the time since it started.
			const created = new Date("2026-10-10T10:00:00Z");
			expect(analyticsRules.deploymentDurationMs(created, null)).toBe(0);
		});

		it("treats a negative duration as no duration", () => {
			// Clock skew, or a completed-at written before the row: reporting it would make an
			// average meaningless.
			const created = new Date("2026-10-10T10:00:00Z");
			const completed = new Date("2026-10-10T09:00:00Z");
			expect(analyticsRules.deploymentDurationMs(created, completed)).toBe(0);
		});
	});

	describe("statusForLatestDeployment", () => {
		it("reports healthy only for a successful deployment", () => {
			expect(analyticsRules.statusForLatestDeployment("success")).toBe("healthy");
		});

		it("reports in-flight as DEGRADED, not unhealthy", () => {
			// A deployment currently running is normal activity. Calling it unhealthy would
			// page somebody for the system working.
			for (const status of ["pending", "queued", "building", "deploying"]) {
				expect(analyticsRules.statusForLatestDeployment(status)).toBe("degraded");
			}
		});

		it("reports a failed deployment as unhealthy", () => {
			expect(analyticsRules.statusForLatestDeployment("failed")).toBe("unhealthy");
		});

		it("reports UNKNOWN for a service that has never deployed", () => {
			// Not unhealthy: a service that has never deployed is not broken, there is nothing
			// to be broken. Collapsing the two would mark every fresh service red, and a
			// dashboard where red is normal is one nobody reads.
			expect(analyticsRules.statusForLatestDeployment(undefined)).toBe("unknown");
		});
	});

	describe("failureReason", () => {
		it("returns null for a deployment that did not fail", () => {
			expect(analyticsRules.failureReason("success", "whatever")).toBeNull();
		});

		it("keeps a failed deployment with no message, and says why it has no reason", () => {
			// Dropping it would quietly remove a failure from a failure count.
			expect(analyticsRules.failureReason("failed", null)).toBe("unknown failure");
			expect(analyticsRules.failureReason("failed", "   ")).toBe("unknown failure");
		});

		it("truncates a long reason so it fits a chart label", () => {
			const reason = analyticsRules.failureReason("failed", "x".repeat(500));
			expect(reason).toHaveLength(120);
			expect(reason?.endsWith("…")).toBe(true);
		});

		it("leaves a short reason untouched", () => {
			expect(analyticsRules.failureReason("failed", "port 8080 in use")).toBe("port 8080 in use");
		});
	});

	describe("unavailable", () => {
		it("pairs an empty series with its reason instead of fabricating numbers", () => {
			// This is the domain's central rule: three metric families have no source, and an
			// empty series says so. A dashboard of fabricated zeros would read as "healthy"
			// when it means "nobody is measuring".
			const payload = analyticsRules.unavailable<{ value: number }>();

			expect(payload.data).toEqual([]);
			expect(payload.dataSource).toBe("unavailable");
		});

		it("carries extra fields alongside, so an empty page still reports its shape", () => {
			const payload = analyticsRules.unavailable<{ value: number }>({ total: 0, limit: 20, offset: 0 });

			expect(payload["total"]).toBe(0);
			expect(payload["limit"]).toBe(20);
		});
	});
});

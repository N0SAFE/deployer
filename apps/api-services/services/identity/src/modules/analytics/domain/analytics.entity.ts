import type { z } from "zod/v4";

import { analyticsDataSourceSchema } from "@deployer/identity-contracts/modules/analytics/schemas";

/** Where a metrics payload came from, as the contract declares it. */
export type AnalyticsDataSource = z.infer<typeof analyticsDataSourceSchema>;

/**
 * The bucket size a `timeRange` + `granularity` pair describes.
 *
 * ── WHY THIS IS PURE DOMAIN AND NOT A SERVICE DETAIL ────────────────────────
 * Every metrics procedure answers the same shape: a series of evenly spaced points.
 * "What are the bucket boundaries" is therefore the definition of what those
 * procedures MEAN, not an implementation detail of any one of them — and keeping it
 * here means a single test covers the time maths for all six.
 */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How long each declared range covers. */
const RANGE_MS: Readonly<Record<string, number>> = {
	"1h": HOUR_MS,
	"6h": 6 * HOUR_MS,
	"12h": 12 * HOUR_MS,
	"1d": DAY_MS,
	"3d": 3 * DAY_MS,
	"7d": 7 * DAY_MS,
	"30d": 30 * DAY_MS,
	"90d": 90 * DAY_MS,
	"1y": 365 * DAY_MS,
};

/** How long one bucket lasts. */
const GRANULARITY_MS: Readonly<Record<string, number>> = {
	minute: 60 * 1000,
	hour: HOUR_MS,
	day: DAY_MS,
};

/**
 * A ceiling on the number of points returned.
 *
 * ── WHY A CEILING EXISTS AT ALL ─────────────────────────────────────────────
 * `1y` at `minute` granularity is ~525,600 points. Those are not "a bigger
 * response" — they are a response no chart can render and no browser can hold, and
 * producing it would tie up a worker for as long as it takes to serialise. The cap
 * makes the worst case a fixed amount of work, and the series remains readable
 * because the buckets simply become coarser than requested.
 *
 * 200 is chosen against the widest range a screen actually plots: 90 days at daily
 * granularity is 90 points, so the cap never bites on a legitimate request.
 */
const MAX_BUCKETS = 200;

/**
 * How a metrics window maps onto buckets.
 *
 * `start`/`end` bound the window; `bucketMs` and `bucketCount` describe the series
 * a caller receives. Together they are everything needed to place a timestamp in a
 * bucket, which is the one operation every metrics procedure performs.
 */
export interface BucketPlan {
	readonly start: Date;
	readonly end: Date;
	readonly bucketMs: number;
	readonly bucketCount: number;
}

/**
 * The rules that make a metrics answer trustworthy.
 *
 * ── WHY `unavailable` IS A VALUE AND NOT AN ERROR ───────────────────────────
 * Three of these metrics (application request counts, database query stats, API
 * usage) have NO connected source. The honest answers are "here are no numbers" and
 * "here is why", because the alternative — inventing plausible values so a chart
 * looks populated — is a lie that gets acted on. A dashboard showing a flat 0%
 * error rate because nothing is instrumented reads as "the system is healthy" when
 * it means "nobody is measuring".
 *
 * So an unsourced metric returns `dataSource: "unavailable"` with an EMPTY series,
 * and the client is expected to say so rather than plot it. This is the single most
 * important rule in this domain: a fabricated metric is worse than a missing one,
 * because a missing one is visibly missing.
 */
export const analyticsRules = {
	/**
	 * The buckets a `timeRange` + `granularity` pair describes.
	 *
	 * ── WHY THE WINDOW ENDS AT `now` ────────────────────────────────────────
	 * A relative range is what every metrics screen asks for, and anchoring on the
	 * caller's clock would make two services disagree about the same request. The
	 * window is therefore computed once, here, and the resulting absolute bounds are
	 * what the rest of the procedure uses.
	 *
	 * Unrecognised values fall back to the declared defaults (`1d` at `hour`) rather
	 * than throwing: the input schema already narrows these to an enum, so a value that
	 * reaches here unrecognised is not a caller error to report but a programming one
	 * — and falling back keeps a metrics endpoint from becoming an outage.
	 */
	bucketPlan(timeRange: string, granularity: string, now: Date = new Date()): BucketPlan {
		const windowMs = RANGE_MS[timeRange] ?? DAY_MS;
		const bucketMs = GRANULARITY_MS[granularity] ?? HOUR_MS;
		const end = now.getTime();
		const start = end - windowMs;

		// Capped rather than unbounded: see `MAX_BUCKETS`. `Math.max(1, …)` keeps a zero
		// or negative result from producing an empty series, which a caller could not
		// distinguish from "no data".
		const bucketCount = Math.max(1, Math.min(MAX_BUCKETS, Math.floor(windowMs / bucketMs)));

		return { start: new Date(start), end: new Date(end), bucketMs, bucketCount };
	},

	/**
	 * Which bucket a timestamp belongs to, CLAMPED to the series.
	 *
	 * ── WHY IT CLAMPS INSTEAD OF RETURNING OUT-OF-RANGE ─────────────────────
	 * A row can legitimately fall outside the window: the range is computed at request
	 * time while the query runs afterwards, so a deployment created in the gap lands
	 * before `start`. Returning `-1` would make the caller either drop the row silently
	 * (losing a real deployment from a count) or index out of bounds. Clamping counts it
	 * in the nearest bucket, which is the honest answer for "as close as the series can
	 * express".
	 */
	bucketIndex(timestamp: Date, plan: BucketPlan): number {
		const raw = Math.floor((timestamp.getTime() - plan.start.getTime()) / plan.bucketMs);
		if (raw < 0) return 0;
		if (raw >= plan.bucketCount) return plan.bucketCount - 1;
		return raw;
	},

	/**
	 * Fold a value into a running average without accumulating the samples.
	 *
	 * ── WHY NOT SUM-AND-DIVIDE ──────────────────────────────────────────────
	 * The deployments are streamed into buckets one at a time and never held as a list,
	 * so the count of prior samples is the only state available. This is the standard
	 * incremental mean and it is exact for the values it was given, not an
	 * approximation.
	 */
	rollingAverage(current: number, countSoFar: number, nextValue: number): number {
		if (countSoFar === 0) return nextValue;
		return Math.round(current + (nextValue - current) / (countSoFar + 1));
	},

	/**
	 * How long a deployment took, or 0 when it has not finished.
	 *
	 * 0 rather than `null`: the contract's `averageDeployTime` is a required number, and
	 * an unfinished deployment has no duration to contribute. Callers must EXCLUDE the
	 * zeros before averaging (the service does), because including them would drag the
	 * average toward zero every time a deployment is still running.
	 */
	deploymentDurationMs(createdAt: Date, completedAt: Date | null): number {
		if (completedAt === null) return 0;
		const duration = completedAt.getTime() - createdAt.getTime();
		// A negative duration means the timestamps disagree (clock skew, or a
		// completed-at set before the row was created). Reporting it would make an
		// average meaningless, so it counts as "no duration".
		return duration > 0 ? duration : 0;
	},

	/**
	 * The status a service is in, given its latest deployment.
	 *
	 * ── WHY "unknown" IS DISTINCT FROM "unhealthy" ──────────────────────────
	 * A service that has never deployed is not broken — there is nothing to be broken.
	 * Collapsing the two would mark every freshly created service red, and a dashboard
	 * where red is normal is a dashboard nobody reads. "unknown" is the honest answer
	 * and the UI can style it as neutral.
	 */
	statusForLatestDeployment(status: string | undefined): "healthy" | "degraded" | "unhealthy" | "unknown" {
		if (status === undefined) return "unknown";
		if (status === "success") return "healthy";
		// In-flight is `degraded`, not `unhealthy`: a deployment currently running is
		// normal activity, and calling it unhealthy would page somebody.
		if (status === "pending" || status === "queued" || status === "building" || status === "deploying") {
			return "degraded";
		}
		return "unhealthy";
	},

	/** A failure's reason, truncated for a chart label. */
	failureReason(status: string, errorMessage: string | null): string | null {
		if (status !== "failed") return null;
		const raw = errorMessage?.trim() ?? "";
		// A failed deployment with no recorded error is still a failure; "unknown failure"
		// keeps it counted rather than dropping it, and says why it has no reason.
		if (raw.length === 0) return "unknown failure";
		return this.truncate(raw, 120);
	},

	/**
	 * Shorten a string to a display length.
	 *
	 * The ellipsis replaces the last character rather than being appended, so the result
	 * never exceeds `max` — a chart label that overflows its bucket is worse than one
	 * that is slightly shorter.
	 */
	truncate(value: string, max: number): string {
		if (value.length <= max) return value;
		return `${value.slice(0, Math.max(0, max - 1))}…`;
	},

	/** Round to one decimal place. */
	round1(value: number): number {
		return Math.round(value * 10) / 10;
	},

	/**
	 * An empty series, paired with the reason it is empty.
	 *
	 * ── WHY THE ELEMENT TYPE IS AN EXPLICIT PARAMETER ───────────────────────
	 * A bare `[]` infers as `never[]`, and without a declared element type the helper's
	 * return widens to `unknown[]` — which does not satisfy any procedure's declared
	 * `data: SomeSchema[]`. Naming the element at the call site is what keeps the empty
	 * payload structurally identical to the populated one, so a caller cannot tell them
	 * apart except by `dataSource` — which is the point.
	 *
	 * Exists so every unsourced metric returns the SAME shape: a caller cannot
	 * accidentally return `{ data: [] }` without a `dataSource`, which would read as "no
	 * activity" rather than "not measured".
	 */
	unavailable<T>(extra: Record<string, unknown> = {}): { data: T[]; dataSource: AnalyticsDataSource } & Record<string, unknown> {
		const data: T[] = [];
		return { data, dataSource: "unavailable", ...extra };
	},
} as const;

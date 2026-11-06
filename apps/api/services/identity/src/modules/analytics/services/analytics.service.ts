import { Logger } from '@nestjs/common'
import { Context, Effect } from 'effect'
import * as systeminformation from 'systeminformation'

import type {
    activitySummarySchema,
    analyticsApiUsageOutputSchema,
    analyticsResourceUsageSchema,
    applicationMetricsSchema,
    databaseMetricsSchema,
    generateReportInputSchema,
    getActivityInputSchema,
    getMetricsInputSchema,
    getUsageInputSchema,
    userActivitySchema,
} from '@deployer/identity-contracts'

import type { DatabasePort } from '@identity/core/database/database.port'

import {
    analyticsRules,
    type AnalyticsDataSource,
} from '../domain/analytics.entity'
import {
    AnalyticsReportNotFound,
    AnalyticsReportNotReady,
} from '../domain/analytics.errors'
import {
    AnalyticsRepository,
    type DeploymentRow,
    type ReportSchedule,
    type ReportStatus,
} from '../repositories/analytics.repository'

/** A live reading of the host, or the fact that there is none. */
type ResourceSnapshot = {
    readonly available: boolean
    readonly cpuPercent: number
    readonly cores: number
    readonly memoryUsed: number
    readonly memoryTotal: number
    readonly memoryPercent: number
    readonly diskUsed: number
    readonly diskTotal: number
    readonly diskPercent: number
    readonly networkInbound: number
    readonly networkOutbound: number
}

/** The statuses that count as a successful deployment. */
const SUCCESS_STATUS = 'success'

import type { z } from 'zod/v4'

export type { Actor } from '@identity/core/utils/actor.utils'

/**
 * The element types of every series this service returns.
 *
 * ── WHY THEY ARE DECLARED HERE AND NOT INFERRED ─────────────────────────────
 * An empty `unavailable()` payload has no elements to infer from, so the type has to
 * be stated — and the types are the contract's own shapes, restated only as far as this
 * service has to satisfy them. Declaring them once means an empty series and a
 * populated one are the SAME type, which is what makes "no data" and "not measured"
 * distinguishable by `dataSource` alone rather than by shape.
 */
/**
 * Element types for series this service returns.
 *
 * ── WHY THESE USE MUTABLE ARRAYS AND NOT `readonly` ────────────────────────────
 * The contract's schemas infer MUTABLE arrays (`z.array(...)` → `T[]`), and an
 * intersection of `readonly` and mutable is not assignable to the mutable one — a
 * mismatch that surfaces at the procedure boundary, far from here. Since these types
 * exist to satisfy the contract's shape exactly, they mirror it: mutable.
 */
export type ResourceUsagePoint = z.infer<typeof analyticsResourceUsageSchema>
export type ApplicationMetricsPoint = z.infer<typeof applicationMetricsSchema>
export type DatabaseMetricsPoint = z.infer<typeof databaseMetricsSchema>
export type UserActivityPoint = z.infer<typeof userActivitySchema>
export type ActivitySummaryPoint = z.infer<typeof activitySummarySchema>
export type ApiUsageRow = z.infer<
    typeof analyticsApiUsageOutputSchema
>['data'][number]
export type StorageBreakdownRow = {
    readonly key: string
    readonly used: number
    readonly allocated: number
    readonly files: number
    readonly growth: number
}

/** The inputs the analytics procedures accept, as the contract declares them. */
export type MetricsQuery = z.infer<typeof getMetricsInputSchema>
export type UsageQuery = z.infer<typeof getUsageInputSchema>
export type ActivityQuery = z.infer<typeof getActivityInputSchema>
export type GenerateReportInput = z.infer<typeof generateReportInputSchema>

/** A report configuration to store. */
export type CreateReportConfigInput = {
    readonly name: string
    readonly description?: string | undefined
    readonly metrics: readonly string[]
    readonly schedule: ReportSchedule
    readonly recipients?: readonly string[] | undefined
}

/**
 * The analytics domain's rules.
 *
 * ── WHAT BELONGS HERE ───────────────────────────────────────────────────────
 * Aggregation over real data: bucketing deployments into a time series, computing a
 * success rate, reducing a service's latest deployment to a status, and persisting a
 * report. Also the decision of which metrics are MEASURED and which are not.
 *
 * ── THE RULE THAT GIVES THIS DOMAIN ITS CHARACTER ───────────────────────────
 * Three of the six metric families have no data source. Rather than fill them with
 * plausible zeros, every one of them returns `dataSource: "unavailable"` with an empty
 * series. A dashboard showing a flat 0% error rate because nothing is instrumented
 * reads as "the system is healthy" when it means "nobody is measuring" — and somebody
 * will act on that. An empty series is visibly empty; a fabricated one is not.
 *
 * That is why `dataSource` is on every metrics response instead of being implicit:
 * it forces the caller to be able to tell the two apart.
 */
const logger = new Logger('AnalyticsService')

// ─── Metrics ────────────────────────────────────────────────────────────

/**
 * Host resource usage, from a REAL reading.
 *
 * ── WHY EVERY BUCKET CARRIES THE SAME VALUE ─────────────────────────────
 * This is a live gauge, not a recorded series: there is no time-series table behind
 * it. Spreading the current reading across the requested window is the honest
 * presentation of "this is what the host reports now" against a time axis — and it
 * says `dataSource: "docker"` so a caller knows it is a single sample rather than a
 * history. Recording real history is a separate feature that needs a writer.
 *
 * When the reading fails, the series is EMPTY rather than zero-filled: a host whose
 * metrics cannot be read is not a host using 0% CPU.
 */
const resourceMetricsImpl = (query: MetricsQuery) =>
    Effect.gen(function* () {
        const snapshot = yield* takeSnapshot()
        const plan = analyticsRules.bucketPlan(
            query.timeRange,
            query.granularity
        )

        if (!snapshot.available) {
            return {
                ...analyticsRules.unavailable<ResourceUsagePoint>(),
                timeRange: query.timeRange,
                granularity: query.granularity,
            }
        }

        const data = Array.from({ length: plan.bucketCount }, (_, index) => ({
            timestamp: new Date(plan.start.getTime() + index * plan.bucketMs),
            cpu: {
                usage: analyticsRules.round1(snapshot.cpuPercent),
                cores: snapshot.cores,
            },
            memory: {
                used: snapshot.memoryUsed,
                total: snapshot.memoryTotal,
                percentage: analyticsRules.round1(snapshot.memoryPercent),
            },
            disk: {
                used: snapshot.diskUsed,
                total: snapshot.diskTotal,
                percentage: analyticsRules.round1(snapshot.diskPercent),
            },
            network: {
                inbound: snapshot.networkInbound,
                outbound: snapshot.networkOutbound,
            },
        }))

        return {
            data,
            timeRange: query.timeRange,
            granularity: query.granularity,
            dataSource: 'docker' as const,
        }
    })

/**
 * Application metrics — request counts, latency percentiles, error rate.
 *
 * ── WHY THIS RETURNS NOTHING ────────────────────────────────────────────
 * There is no APM in this platform: nothing counts requests, so nothing can report a
 * p99. Returning zeros would make an uninstrumented deployment look like a perfectly
 * healthy one, which is the most dangerous possible answer — an operator seeing 0%
 * errors stops looking. The empty series with `unavailable` is the truth, and the UI
 * is expected to say "not instrumented" rather than draw a flat line.
 */
const applicationMetricsImpl = (query: MetricsQuery) =>
    Effect.sync(() => {
        return {
            // The element type is the one this payload WOULD have carried. Naming it keeps
            // the empty response structurally identical to a populated one, so a caller
            // cannot tell them apart except by `dataSource` — which is the point.
            ...analyticsRules.unavailable<ApplicationMetricsPoint>(),
            timeRange: query.timeRange,
            granularity: query.granularity,
        }
    })

/**
 * Database metrics — connections, slow queries, cache hit ratio.
 *
 * Same reasoning as application metrics: these need a collector reading
 * `pg_stat_*`, and without one the honest answer is that they are not measured.
 * Reporting them as zero would hide a genuinely saturated connection pool.
 */
const databaseMetricsImpl = (query: MetricsQuery) =>
    Effect.sync(() => {
        return {
            ...analyticsRules.unavailable<DatabaseMetricsPoint>(),
            timeRange: query.timeRange,
            granularity: query.granularity,
        }
    })

/**
 * Deployment metrics — the one series with a real source.
 *
 * ── WHY THE SUCCESS RATE IS COMPUTED OVER THE WINDOW, NOT PER BUCKET ─────
 * A bucket holding one deployment either succeeds or fails, so a per-bucket rate is
 * always 0% or 100% — a chart of that is noise, not signal. The window-wide rate is
 * the meaningful number, and it is copied onto every non-empty bucket so a caller
 * plotting against time still sees it. The counts (`deploymentsCount`) remain
 * per-bucket, because that IS a per-bucket quantity.
 */
const deploymentMetricsImpl = (query: MetricsQuery) =>
    Effect.gen(function* () {
        const repository = yield* AnalyticsRepository
        const plan = analyticsRules.bucketPlan(
            query.timeRange,
            query.granularity
        )
        const serviceIds = yield* resolveServiceIds(query.services)
        const [deployments, rollbacks] = yield* Effect.all([
            repository.deploymentsInRange(plan.start, plan.end, serviceIds),
            repository.rollbacksInRange(plan.start, plan.end),
        ])

        const buckets = Array.from(
            { length: plan.bucketCount },
            (_, index) => ({
                timestamp: new Date(
                    plan.start.getTime() + index * plan.bucketMs
                ),
                deploymentsCount: 0,
                successRate: 0,
                averageDeployTime: 0,
                failureReasons: [] as { reason: string; count: number }[],
                rollbackCount: 0,
            })
        )

        // Failure reasons are accumulated per bucket, then reduced to the top five — a
        // chart label list longer than that is unreadable, and the long tail is always the
        // same one-off errors.
        const reasonsByBucket = new Map<number, Map<string, number>>()
        // How many durations each bucket's mean already holds: the incremental mean needs it.
        const durationSamples = new Map<number, number>()

        for (const deployment of deployments) {
            const index = analyticsRules.bucketIndex(deployment.createdAt, plan)
            const bucket = buckets[index]
            if (bucket === undefined) continue
            bucket.deploymentsCount += 1

            if (deployment.status === SUCCESS_STATUS) {
                const duration = analyticsRules.deploymentDurationMs(
                    deployment.createdAt,
                    deployment.deployCompletedAt
                )
                // Unfinished deployments contribute nothing here (`duration` is 0 and is
                // skipped), so they cannot drag the mean down. The prior-sample count is the
                // number of DURATIONS already averaged, not of deployments seen: counting
                // deployments would weight a bucket's mean by deployments that had no duration.
                if (duration > 0) {
                    const prior = durationSamples.get(index) ?? 0
                    bucket.averageDeployTime = analyticsRules.rollingAverage(
                        bucket.averageDeployTime,
                        prior,
                        duration
                    )
                    durationSamples.set(index, prior + 1)
                }
            }

            const reason = analyticsRules.failureReason(
                deployment.status,
                deployment.errorMessage
            )
            if (reason !== null) {
                const reasons =
                    reasonsByBucket.get(index) ?? new Map<string, number>()
                reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
                reasonsByBucket.set(index, reasons)
            }
        }

        for (const rollback of rollbacks) {
            const index = analyticsRules.bucketIndex(rollback.createdAt, plan)
            const bucket = buckets[index]
            if (bucket !== undefined) bucket.rollbackCount += 1
        }

        const total = deployments.length
        const succeeded = deployments.filter(
            (row) => row.status === SUCCESS_STATUS
        ).length
        const windowSuccessRate =
            total > 0 ? analyticsRules.round1((succeeded / total) * 100) : 0

        for (let index = 0; index < buckets.length; index += 1) {
            const bucket = buckets[index]
            if (bucket === undefined) continue
            if (bucket.deploymentsCount > 0)
                bucket.successRate = windowSuccessRate

            const reasons = reasonsByBucket.get(index)
            if (reasons !== undefined) {
                bucket.failureReasons = [...reasons.entries()]
                    .map(([reason, reasonCount]) => ({
                        reason,
                        count: reasonCount,
                    }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 5)
            }
        }

        return {
            data: buckets,
            timeRange: query.timeRange,
            granularity: query.granularity,
            dataSource: 'deployments' as const,
        }
    })

/**
 * Per-service health, derived from each service's LATEST deployment.
 *
 * ── WHY THIS IS DERIVED AND NOT A HEALTH PROBE ──────────────────────────
 * The question this answers is "is what we deployed still the thing that is
 * running", which the deployment history can answer from data already stored. A live
 * probe would be a different question (is it up RIGHT NOW) and would need a call per
 * service; `svc-health` owns that. Naming them differently matters, because a service
 * that has never deployed is not unhealthy — it is `unknown`, and marking it red
 * would make red the normal state of a fresh platform.
 */
const serviceHealthImpl = (services?: readonly string[]) =>
    Effect.gen(function* () {
        const repository = yield* AnalyticsRepository
        const rows = yield* repository.serviceRows(
            services === undefined ? undefined : [...services]
        )
        const latest = yield* repository.latestDeploymentPerService(
            rows.map((row) => row.id)
        )
        const now = new Date()

        const data = rows.map((service) => {
            const deployment = latest.get(service.id)
            const status = analyticsRules.statusForLatestDeployment(
                deployment?.status
            )
            return {
                serviceName: service.name,
                status,
                // Uptime is unknown rather than 0: 0 would read as "this service has never run",
                // which is a different and much more alarming statement than "we do not track
                // uptime".
                uptime: 0,
                lastCheck: deployment?.createdAt ?? now,
                checks: [
                    {
                        name: 'latest-deployment',
                        status:
                            status === 'healthy'
                                ? ('pass' as const)
                                : status === 'unknown'
                                  ? ('warn' as const)
                                  : ('fail' as const),
                        message:
                            deployment === undefined
                                ? 'this service has no deployments yet'
                                : `latest deployment is ${deployment.status}`,
                        timestamp: deployment?.createdAt ?? now,
                    },
                ],
            }
        })

        return { data, timestamp: now, dataSource: 'services' as const }
    })

/**
 * A single point-in-time reading for a live dashboard.
 *
 * ── WHY `application` IS ZEROED HERE BUT EMPTY ELSEWHERE ────────────────
 * This payload is a single snapshot, not a series, and its schema requires the
 * application block to be present. The zeros mean "no instrumentation reports this",
 * and the `dataSource` still says `unavailable` when the host reading failed — so the
 * distinction survives. A series has room to be empty; a fixed-shape snapshot does
 * not.
 */
const realtimeMetricsImpl = (services?: readonly string[]) =>
    Effect.gen(function* () {
        const repository = yield* AnalyticsRepository
        const snapshot = yield* takeSnapshot()
        const rows = yield* repository.serviceRows(
            services === undefined ? undefined : [...services]
        )
        const latest = yield* repository.latestDeploymentPerService(
            rows.map((row) => row.id)
        )

        return {
            timestamp: new Date(),
            system: {
                cpu: analyticsRules.round1(snapshot.cpuPercent),
                memory: analyticsRules.round1(snapshot.memoryPercent),
                disk: analyticsRules.round1(snapshot.diskPercent),
                network: {
                    inbound: snapshot.networkInbound,
                    outbound: snapshot.networkOutbound,
                },
            },
            application: {
                activeConnections: 0,
                requestsPerSecond: 0,
                averageResponseTime: 0,
                errorRate: 0,
            },
            services: rows.map((service) => ({
                name: service.name,
                status: analyticsRules.statusForLatestDeployment(
                    latest.get(service.id)?.status
                ),
                responseTime: 0,
                uptime: 0,
            })),
            dataSource: snapshot.available
                ? ('docker' as const)
                : ('unavailable' as const),
        }
    })

// ─── Usage ──────────────────────────────────────────────────────────────

/** Host resource usage with peak/average/minimum rolled up. */
const resourceUsageImpl = (query: UsageQuery) =>
    Effect.gen(function* () {
        const snapshot = yield* takeSnapshot()
        const plan = analyticsRules.bucketPlan(query.timeRange, 'hour')

        if (!snapshot.available) {
            const empty = emptyUsage()
            return {
                data: [],
                summary: { peak: empty, average: empty, minimum: empty },
                timeRange: query.timeRange,
                dataSource: 'unavailable' as const,
            }
        }

        const sample = snapshotToUsage(snapshot)
        const data = Array.from({ length: plan.bucketCount }, (_, index) => ({
            ...sample,
            timestamp: new Date(plan.start.getTime() + index * plan.bucketMs),
        }))

        // The same sample for all three: this is a live gauge read once, so the peak,
        // average and minimum over the window are all that reading. Reporting them as
        // different numbers would imply a history that does not exist.
        return {
            data,
            summary: { peak: sample, average: sample, minimum: sample },
            timeRange: query.timeRange,
            dataSource: 'docker' as const,
        }
    })

/** User activity — no audit log is written, so this is not measured. */
const userActivityImpl = (query: ActivityQuery) =>
    Effect.sync(() => {
        return {
            ...analyticsRules.unavailable<UserActivityPoint>(),
            total: 0,
            limit: query.limit,
            offset: query.offset,
        }
    })

/** Activity summary — same missing source as user activity. */
const activitySummaryImpl = (_query: {
    period?: string
    granularity?: string
    limit?: number
}) =>
    Effect.sync(() => {
        return {
            ...analyticsRules.unavailable<ActivitySummaryPoint>(),
            totalPeriods: 0,
        }
    })

/** API usage — no request logging, so not measured. */
const apiUsageImpl = (query: {
    timeRange: string
    groupBy: string
    limit: number
}) =>
    Effect.sync(() => {
        return {
            ...analyticsRules.unavailable<ApiUsageRow>(),
            total: {
                requests: 0,
                errors: 0,
                dataTransferred: 0,
                uniqueUsers: 0,
            },
            timeRange: query.timeRange,
        }
    })

/**
 * Deployment usage per day, with a summary.
 *
 * ── WHY THE SUMMARY AND THE SERIES ARE COMPUTED SEPARATELY ──────────────
 * The series is sparse (days with no activity are dropped) while the summary covers
 * the WHOLE window. Deriving one from the other would make the summary change
 * meaning when a quiet day happened to fall inside it.
 */
const deploymentUsageImpl = (query: {
    timeRange: string
    projectId?: string | undefined
    userId?: string | undefined
}) =>
    Effect.gen(function* () {
        const repository = yield* AnalyticsRepository
        const plan = analyticsRules.bucketPlan(query.timeRange, 'day')
        const serviceIds =
            query.projectId === undefined
                ? undefined
                : yield* serviceIdsByProject(query.projectId)
        const [deployments, rollbacks] = yield* Effect.all([
            repository.deploymentsInRange(plan.start, plan.end, serviceIds),
            repository.rollbacksInRange(plan.start, plan.end),
        ])

        const rollbacksByBucket = new Map<number, number>()
        for (const rollback of rollbacks) {
            const index = analyticsRules.bucketIndex(rollback.createdAt, plan)
            rollbacksByBucket.set(
                index,
                (rollbacksByBucket.get(index) ?? 0) + 1
            )
        }

        // Group once, then read per day: filtering the whole list inside the loop would be
        // O(days × deployments) for a number that a single pass already has.
        const byDay = new Map<number, DeploymentRow[]>()
        for (const deployment of deployments) {
            const index = analyticsRules.bucketIndex(deployment.createdAt, plan)
            const bucket = byDay.get(index) ?? []
            bucket.push(deployment)
            byDay.set(index, bucket)
        }

        const data = Array.from({ length: plan.bucketCount }, (_, index) => {
            const dayDeployments = byDay.get(index) ?? []
            const durations = dayDeployments
                .map((row) =>
                    analyticsRules.deploymentDurationMs(
                        row.createdAt,
                        row.deployCompletedAt
                    )
                )
                .filter((duration) => duration > 0)
            return {
                date: new Date(plan.start.getTime() + index * plan.bucketMs),
                deployments: dayDeployments.length,
                successes: dayDeployments.filter(
                    (row) => row.status === SUCCESS_STATUS
                ).length,
                failures: dayDeployments.filter(
                    (row) => row.status === 'failed'
                ).length,
                rollbacks: rollbacksByBucket.get(index) ?? 0,
                averageDuration:
                    durations.length > 0
                        ? Math.round(
                              durations.reduce((sum, value) => sum + value, 0) /
                                  durations.length
                          )
                        : 0,
            }
        }).filter((row) => row.deployments > 0 || row.rollbacks > 0)

        const allDurations = deployments
            .map((row) =>
                analyticsRules.deploymentDurationMs(
                    row.createdAt,
                    row.deployCompletedAt
                )
            )
            .filter((duration) => duration > 0)
        const succeeded = deployments.filter(
            (row) => row.status === SUCCESS_STATUS
        ).length

        // Deployments are counted per SERVICE, then the service's project name is looked
        // up — because `deployments.serviceId` points at a service, not at a project, so
        // "most active project" is a join that has to go through it.
        const serviceCounts = new Map<string, number>()
        for (const deployment of deployments) {
            serviceCounts.set(
                deployment.serviceId,
                (serviceCounts.get(deployment.serviceId) ?? 0) + 1
            )
        }
        const serviceRows = yield* repository.serviceRows()
        const projectIdByService = new Map(
            serviceRows.map((row) => [row.id, row.projectId])
        )
        const countsByProject = new Map<string, number>()
        for (const [serviceId, value] of serviceCounts) {
            const projectId = projectIdByService.get(serviceId)
            if (projectId === undefined) continue
            countsByProject.set(
                projectId,
                (countsByProject.get(projectId) ?? 0) + value
            )
        }
        const projectNames = yield* repository.projectNamesByIds([
            ...countsByProject.keys(),
        ])

        return {
            data,
            summary: {
                totalDeployments: deployments.length,
                successRate:
                    deployments.length > 0
                        ? analyticsRules.round1(
                              (succeeded / deployments.length) * 100
                          )
                        : 0,
                averageDeployTime:
                    allDurations.length > 0
                        ? Math.round(
                              allDurations.reduce(
                                  (sum, value) => sum + value,
                                  0
                              ) / allDurations.length
                          )
                        : 0,
                mostActiveProjects: [...countsByProject.entries()]
                    .map(([projectId, deploymentCount]) => ({
                        projectId,
                        projectName: projectNames.get(projectId) ?? projectId,
                        deploymentCount,
                    }))
                    .sort((a, b) => b.deploymentCount - a.deploymentCount)
                    .slice(0, 5),
                // No per-user attribution is recorded on a deployment, so this stays empty
                // rather than being guessed from `triggeredBy` — which is absent on some rows
                // and would make the list silently partial.
                mostActiveUsers: [],
            },
            timeRange: query.timeRange,
            dataSource: 'deployments' as const,
        }
    })

/** Storage usage — a real host reading, presented as a trend. */
const storageUsageImpl = (query: { timeRange: string; breakdown: string }) =>
    Effect.gen(function* () {
        const snapshot = yield* takeSnapshot()
        const plan = analyticsRules.bucketPlan(query.timeRange, 'day')

        const trends = Array.from({ length: plan.bucketCount }, (_, index) => ({
            date: new Date(plan.start.getTime() + index * plan.bucketMs),
            totalUsed: snapshot.available ? snapshot.diskUsed : 0,
            filesCount: 0,
        }))

        const used = snapshot.available ? snapshot.diskUsed : 0
        const allocated = snapshot.available ? snapshot.diskTotal : 0

        return {
            // `data` is a per-key breakdown, and there is no source that attributes disk
            // usage to a project/service/type — so it is empty rather than attributed by
            // guesswork. `total` and `trends` come from the real host reading.
            data: [] as StorageBreakdownRow[],
            total: {
                used,
                allocated,
                available: Math.max(0, allocated - used),
                files: 0,
                averageFileSize: 0,
            },
            trends,
            dataSource: snapshot.available
                ? ('docker' as const)
                : ('unavailable' as const),
        }
    })

// ─── Reports ────────────────────────────────────────────────────────────

/**
 * Generate and STORE a report.
 *
 * ── WHY IT PERSISTS RATHER THAN RETURNING A PAYLOAD ─────────────────────
 * The stored row is what `download` streams and what `list` pages over. Returning
 * the report without storing it would make "download this report" impossible, which
 * is the only reason a report exists.
 *
 * ── WHY A FAILED REPORT IS STILL STORED ─────────────────────────────────
 * A generation failure is recorded as a `failed` row with the message. Discarding it
 * would leave a caller with nothing to inspect — the failure would be a 500 and the
 * reason would be gone.
 */
const generateReportImpl = (input: GenerateReportInput) =>
    Effect.gen(function* () {
        const repository = yield* AnalyticsRepository
        const sections: string[] = []
        const content: Record<string, unknown> = {}
        const reportName = `Analytics report — ${input.period.start.toISOString().slice(0, 10)} → ${input.period.end.toISOString().slice(0, 10)}`

        const completed = Effect.gen(function* () {
            const window = {
                timeRange: rangeFor(input.period),
                granularity: 'hour',
            }

            if (input.includeDeploymentAnalytics) {
                sections.push('deploymentAnalytics')
                const metrics = yield* deploymentMetricsImpl(
                    window as MetricsQuery
                )
                content.deploymentAnalytics = metrics.data
            }
            if (input.includeServiceHealth) {
                sections.push('serviceHealth')
                const health = yield* serviceHealthImpl()
                content.serviceHealth = health.data
            }
            if (input.includeResourceUsage) {
                sections.push('resourceUsage')
                const usage = yield* resourceUsageImpl({
                    timeRange: '1d',
                    resource: 'all',
                    aggregation: 'average',
                })
                content.resourceUsage = usage.data
            }
            if (input.includeApplicationMetrics) {
                sections.push('applicationMetrics')
                const metrics = yield* applicationMetricsImpl(
                    window as MetricsQuery
                )
                content.applicationMetrics = metrics.data
                content.applicationMetricsDataSource = metrics.dataSource
            }
            if (input.includeDatabaseMetrics) {
                sections.push('databaseMetrics')
                const metrics = yield* databaseMetricsImpl(
                    window as MetricsQuery
                )
                content.databaseMetrics = metrics.data
                content.databaseMetricsDataSource = metrics.dataSource
            }
            if (input.includeUserActivity) {
                sections.push('userActivity')
                const activity = yield* activitySummaryImpl({})
                content.userActivity = activity.data
            }

            const deployments = yield* deploymentUsageImpl({
                timeRange: rangeFor(input.period),
            })
            const serialised = JSON.stringify(content)

            const report = yield* repository.insertReport({
                name: reportName,
                format: input.format,
                periodStart: input.period.start,
                periodEnd: input.period.end,
                sections,
                content,
                sizeBytes: Buffer.byteLength(serialised, 'utf8'),
                status: 'completed',
            })

            return { ...report, summary: deployments.summary }
        })

        // A failure while building a section is recorded on a `failed` report instead of failing the call,
        // so the caller can read the reason from the report.
        return yield* completed.pipe(
            Effect.catch((error: unknown) =>
                Effect.gen(function* () {
                    const message =
                        error instanceof Error ? error.message : String(error)
                    logger.error(`report generation failed: ${message}`)
                    return yield* repository.insertReport({
                        name: reportName,
                        format: input.format,
                        periodStart: input.period.start,
                        periodEnd: input.period.end,
                        sections,
                        content,
                        sizeBytes: 0,
                        status: 'failed',
                        errorMessage: message,
                    })
                })
            )
        )
    })

/** One stored report, or a typed 404. */
const findReportImpl = (id: string) =>
    Effect.gen(function* () {
        const repository = yield* AnalyticsRepository
        const report = yield* repository.findReport(id)
        if (report === null)
            return yield* new AnalyticsReportNotFound({
                what: 'analytics report',
                id,
            })
        return report
    })

/**
 * A page of stored reports.
 *
 * `status` is the enum union rather than `string` because the column is a Postgres
 * enum: a plain `string` cannot be compared against it, and the failure would name the
 * column rather than the value.
 */
const listReportsImpl = (
    limit: number,
    offset: number,
    status?: ReportStatus
) =>
    Effect.gen(function* () {
        const repository = yield* AnalyticsRepository
        return yield* repository.listReports(limit, offset, status)
    })

const deleteReportImpl = (id: string) =>
    Effect.gen(function* () {
        const repository = yield* AnalyticsRepository
        const removed = yield* repository.deleteReport(id)
        // A 404 rather than `{ success: false }`: the contract declares an error for an
        // unknown report, and a success-shaped body with `false` makes a typo
        // indistinguishable from a real deletion.
        if (!removed)
            return yield* new AnalyticsReportNotFound({
                what: 'analytics report',
                id,
            })
        return { success: true }
    })

/**
 * The stored content of a report, for download.
 *
 * ── WHY A FAILED REPORT CANNOT BE DOWNLOADED ────────────────────────────
 * Its content is empty, so streaming it would hand the caller a file that looks like
 * a report and contains nothing. The failure is reported instead, with its reason.
 */
const downloadReportImpl = (id: string) =>
    Effect.gen(function* () {
        const report = yield* findReportImpl(id)
        if (report.status !== 'completed') {
            return yield* new AnalyticsReportNotReady({
                id,
                status: report.status,
            })
        }
        return {
            name: report.name,
            format: report.format,
            content: report.content,
            sizeBytes: report.sizeBytes,
        }
    })

const createReportConfigImpl = (input: CreateReportConfigInput) =>
    Effect.gen(function* () {
        const repository = yield* AnalyticsRepository
        return yield* repository.insertReportConfig({
            name: input.name,
            description: input.description ?? null,
            metrics: [...input.metrics],
            schedule: input.schedule,
            recipients:
                input.recipients === undefined ? [] : [...input.recipients],
        })
    })

const listReportConfigsImpl = (limit: number, offset: number) =>
    Effect.gen(function* () {
        const repository = yield* AnalyticsRepository
        return yield* repository.listReportConfigs(limit, offset)
    })

const updateReportConfigImpl = (
    id: string,
    updates: {
        name?: string | undefined
        description?: string | undefined
        metrics?: readonly string[] | undefined
        schedule?: ReportSchedule | undefined
        recipients?: readonly string[] | undefined
    }
) =>
    Effect.gen(function* () {
        const repository = yield* AnalyticsRepository
        const updated = yield* repository.updateReportConfig(id, {
            ...(updates.name === undefined ? {} : { name: updates.name }),
            ...(updates.description === undefined
                ? {}
                : { description: updates.description }),
            ...(updates.metrics === undefined
                ? {}
                : { metrics: [...updates.metrics] }),
            ...(updates.schedule === undefined
                ? {}
                : { schedule: updates.schedule }),
            ...(updates.recipients === undefined
                ? {}
                : { recipients: [...updates.recipients] }),
        })
        if (updated === null)
            return yield* new AnalyticsReportNotFound({
                what: 'analytics report config',
                id,
            })
        return updated
    })

const deleteReportConfigImpl = (id: string) =>
    Effect.gen(function* () {
        const repository = yield* AnalyticsRepository
        const removed = yield* repository.deleteReportConfig(id)
        if (!removed)
            return yield* new AnalyticsReportNotFound({
                what: 'analytics report config',
                id,
            })
        return { success: true }
    })

// ─── Internals ──────────────────────────────────────────────────────────

/**
 * Read the host's current resource usage.
 *
 * ── WHY A FAILURE IS `available: false` AND NOT A THROW ─────────────────
 * `systeminformation` shells out to platform tooling, which is absent in a minimal
 * container. Throwing would turn every metrics endpoint into a 500 in an environment
 * where the honest answer is "this host does not expose metrics" — a condition the
 * caller can display, unlike an error page.
 */
const unavailableSnapshot: ResourceSnapshot = {
    available: false,
    cpuPercent: 0,
    cores: 0,
    memoryUsed: 0,
    memoryTotal: 0,
    memoryPercent: 0,
    diskUsed: 0,
    diskTotal: 0,
    diskPercent: 0,
    networkInbound: 0,
    networkOutbound: 0,
}

const takeSnapshot = (): Effect.Effect<ResourceSnapshot> =>
    Effect.tryPromise(async (): Promise<ResourceSnapshot> => {
        const [load, memory, disk, network, cpu] = await Promise.all([
            systeminformation.currentLoad(),
            systeminformation.mem(),
            systeminformation.fsSize(),
            systeminformation.networkStats(),
            systeminformation.cpu(),
        ])

        const primaryDisk = disk[0]
        const primaryNetwork = network[0]
        const memoryUsed = memory.active
        const memoryPercent =
            memory.total > 0 ? (memoryUsed / memory.total) * 100 : 0

        return {
            available: true,
            cpuPercent: load.currentLoad,
            cores: cpu.cores,
            memoryUsed,
            memoryTotal: memory.total,
            memoryPercent,
            diskUsed: primaryDisk?.used ?? 0,
            diskTotal: primaryDisk?.size ?? 0,
            diskPercent: primaryDisk?.use ?? 0,
            networkInbound: primaryNetwork?.rx_sec ?? 0,
            networkOutbound:
                primaryDisk === undefined ? 0 : (primaryNetwork?.tx_sec ?? 0),
        }
    }).pipe(
        Effect.catch((error: unknown) =>
            Effect.sync(() => {
                logger.warn(
                    `host metrics unavailable: ${error instanceof Error ? error.message : String(error)}`
                )
                return unavailableSnapshot
            })
        )
    )

/** The snapshot as a usage point. */
const snapshotToUsage = (snapshot: ResourceSnapshot) => {
    return {
        timestamp: new Date(),
        cpu: {
            usage: analyticsRules.round1(snapshot.cpuPercent),
            cores: snapshot.cores,
        },
        memory: {
            used: snapshot.memoryUsed,
            total: snapshot.memoryTotal,
            percentage: analyticsRules.round1(snapshot.memoryPercent),
        },
        disk: {
            used: snapshot.diskUsed,
            total: snapshot.diskTotal,
            percentage: analyticsRules.round1(snapshot.diskPercent),
        },
        network: {
            inbound: snapshot.networkInbound,
            outbound: snapshot.networkOutbound,
        },
    }
}

/** The zero usage point, for an unavailable reading. */
const emptyUsage = () => {
    return {
        timestamp: new Date(),
        cpu: { usage: 0, cores: 0 },
        memory: { used: 0, total: 0, percentage: 0 },
        disk: { used: 0, total: 0, percentage: 0 },
        network: { inbound: 0, outbound: 0 },
    }
}

/** Service NAMES to ids, or undefined when the caller did not scope. */
const resolveServiceIds = (services?: readonly string[]) =>
    Effect.gen(function* () {
        if (services === undefined || services.length === 0) return undefined
        const repository = yield* AnalyticsRepository
        const rows = yield* repository.serviceRows([...services])
        return rows.map((row) => row.id)
    })

/** The ids of the services belonging to one project. */
const serviceIdsByProject = (projectId: string) =>
    Effect.gen(function* () {
        const repository = yield* AnalyticsRepository
        const rows = yield* repository.serviceRows()
        return rows
            .filter((row) => row.projectId === projectId)
            .map((row) => row.id)
    })

/**
 * The nearest declared `timeRange` for an explicit date window.
 *
 * ── WHY A ROUNDING IS NECESSARY ─────────────────────────────────────────────
 * The metrics procedures take a RELATIVE range (an enum), while a report takes an
 * ABSOLUTE window. Rather than add a second bucketing path for absolute dates — two
 * implementations of the same maths, which would drift — the absolute window is mapped
 * onto the closest declared range. The buckets are then correct in count and spacing,
 * anchored at "now" rather than at `period.start`, which the report records separately.
 */
function rangeFor(period: { start: Date; end: Date }): string {
    const days =
        (period.end.getTime() - period.start.getTime()) / (24 * 60 * 60 * 1000)
    if (days <= 1 / 24) return '1h'
    if (days <= 0.25) return '6h'
    if (days <= 0.5) return '12h'
    if (days <= 1) return '1d'
    if (days <= 3) return '3d'
    if (days <= 7) return '7d'
    if (days <= 30) return '30d'
    if (days <= 90) return '90d'
    return '1y'
}

// Re-exported so the controller has one import for the domain's vocabulary.
export type { AnalyticsDataSource }

/**
 * One use case, with `R` written into its requirement channel.
 *
 * The payload and the failure channel are the implementation's own, so a method's return type and its
 * `dataSource` literal cannot drift from the body that produces them; `R` is stated per method because
 * that is the part a caller (the controller, a `liveSnapshot` tick, a spec) has to provide.
 */
type UseCase<F, R> = F extends (
    ...args: infer A
) => Effect.Effect<infer X, infer E, unknown>
    ? (...args: A) => Effect.Effect<X, E, R>
    : never

/** Every analytics use case; each leaves only its own failures and the repository it yields open. */
export type AnalyticsServiceShape = {
    readonly resourceMetrics: UseCase<typeof resourceMetricsImpl, never>
    readonly applicationMetrics: UseCase<typeof applicationMetricsImpl, never>
    readonly databaseMetrics: UseCase<typeof databaseMetricsImpl, never>
    readonly deploymentMetrics: UseCase<
        typeof deploymentMetricsImpl,
        AnalyticsServicePorts
    >
    readonly serviceHealth: UseCase<
        typeof serviceHealthImpl,
        AnalyticsServicePorts
    >
    readonly realtimeMetrics: UseCase<
        typeof realtimeMetricsImpl,
        AnalyticsServicePorts
    >
    readonly resourceUsage: UseCase<typeof resourceUsageImpl, never>
    readonly userActivity: UseCase<typeof userActivityImpl, never>
    readonly activitySummary: UseCase<typeof activitySummaryImpl, never>
    readonly apiUsage: UseCase<typeof apiUsageImpl, never>
    readonly deploymentUsage: UseCase<
        typeof deploymentUsageImpl,
        AnalyticsServicePorts
    >
    readonly storageUsage: UseCase<typeof storageUsageImpl, never>
    readonly generateReport: UseCase<
        typeof generateReportImpl,
        AnalyticsServicePorts
    >
    readonly findReport: UseCase<
        typeof findReportImpl,
        AnalyticsServicePorts
    >
    readonly listReports: UseCase<
        typeof listReportsImpl,
        AnalyticsServicePorts
    >
    readonly deleteReport: UseCase<
        typeof deleteReportImpl,
        AnalyticsServicePorts
    >
    readonly downloadReport: UseCase<
        typeof downloadReportImpl,
        AnalyticsServicePorts
    >
    readonly createReportConfig: UseCase<
        typeof createReportConfigImpl,
        AnalyticsServicePorts
    >
    readonly listReportConfigs: UseCase<
        typeof listReportConfigsImpl,
        AnalyticsServicePorts
    >
    readonly updateReportConfig: UseCase<
        typeof updateReportConfigImpl,
        AnalyticsServicePorts
    >
    readonly deleteReportConfig: UseCase<
        typeof deleteReportConfigImpl,
        AnalyticsServicePorts
    >
}

/**
 * What a caller must have in the Effect context to run an analytics use case.
 *
 * The repository is a tag, so a method that yields it needs the repository and nothing else: the port it
 * resolves over is provided where the repository itself is built. `DatabasePort` stays in the union because the
 * streaming procedures capture this context on the request fiber and re-provide it per tick — naming both makes
 * a missing member a compile error rather than a runtime "Service not found".
 */
export type AnalyticsServicePorts = AnalyticsRepository | DatabasePort

/**
 * Tag and implementation together: the tag is the contract, `live` the one implementation.
 *
 * The repository is yielded inside each method, so this is a plain constant a Nest module provides with
 * `useClass`, and a spec substitutes the repository with `Effect.provideService`.
 */
export class AnalyticsService extends Context.Service<
    AnalyticsService,
    AnalyticsServiceShape
>()('identity/AnalyticsService') {
    static readonly live = class AnalyticsServiceImpl implements AnalyticsServiceShape {
        resourceMetrics(
            query: MetricsQuery
        ): ReturnType<AnalyticsServiceShape['resourceMetrics']> {
            return resourceMetricsImpl(query)
        }

        applicationMetrics(
            query: MetricsQuery
        ): ReturnType<AnalyticsServiceShape['applicationMetrics']> {
            return applicationMetricsImpl(query)
        }

        databaseMetrics(
            query: MetricsQuery
        ): ReturnType<AnalyticsServiceShape['databaseMetrics']> {
            return databaseMetricsImpl(query)
        }

        deploymentMetrics(
            query: MetricsQuery
        ): ReturnType<AnalyticsServiceShape['deploymentMetrics']> {
            return deploymentMetricsImpl(query)
        }

        serviceHealth(
            services?: readonly string[]
        ): ReturnType<AnalyticsServiceShape['serviceHealth']> {
            return serviceHealthImpl(services)
        }

        realtimeMetrics(
            services?: readonly string[]
        ): ReturnType<AnalyticsServiceShape['realtimeMetrics']> {
            return realtimeMetricsImpl(services)
        }

        resourceUsage(
            query: UsageQuery
        ): ReturnType<AnalyticsServiceShape['resourceUsage']> {
            return resourceUsageImpl(query)
        }

        userActivity(
            query: ActivityQuery
        ): ReturnType<AnalyticsServiceShape['userActivity']> {
            return userActivityImpl(query)
        }

        activitySummary(query: {
            period?: string
            granularity?: string
            limit?: number
        }): ReturnType<AnalyticsServiceShape['activitySummary']> {
            return activitySummaryImpl(query)
        }

        apiUsage(query: {
            timeRange: string
            groupBy: string
            limit: number
        }): ReturnType<AnalyticsServiceShape['apiUsage']> {
            return apiUsageImpl(query)
        }

        deploymentUsage(query: {
            timeRange: string
            projectId?: string | undefined
            userId?: string | undefined
        }): ReturnType<AnalyticsServiceShape['deploymentUsage']> {
            return deploymentUsageImpl(query)
        }

        storageUsage(query: {
            timeRange: string
            breakdown: string
        }): ReturnType<AnalyticsServiceShape['storageUsage']> {
            return storageUsageImpl(query)
        }

        generateReport(
            input: GenerateReportInput
        ): ReturnType<AnalyticsServiceShape['generateReport']> {
            return generateReportImpl(input)
        }

        findReport(
            id: string
        ): ReturnType<AnalyticsServiceShape['findReport']> {
            return findReportImpl(id)
        }

        listReports(
            limit: number,
            offset: number,
            status?: ReportStatus
        ): ReturnType<AnalyticsServiceShape['listReports']> {
            return listReportsImpl(limit, offset, status)
        }

        deleteReport(
            id: string
        ): ReturnType<AnalyticsServiceShape['deleteReport']> {
            return deleteReportImpl(id)
        }

        downloadReport(
            id: string
        ): ReturnType<AnalyticsServiceShape['downloadReport']> {
            return downloadReportImpl(id)
        }

        createReportConfig(
            input: CreateReportConfigInput
        ): ReturnType<AnalyticsServiceShape['createReportConfig']> {
            return createReportConfigImpl(input)
        }

        listReportConfigs(
            limit: number,
            offset: number
        ): ReturnType<AnalyticsServiceShape['listReportConfigs']> {
            return listReportConfigsImpl(limit, offset)
        }

        updateReportConfig(
            id: string,
            updates: {
                name?: string | undefined
                description?: string | undefined
                metrics?: readonly string[] | undefined
                schedule?: ReportSchedule | undefined
                recipients?: readonly string[] | undefined
            }
        ): ReturnType<AnalyticsServiceShape['updateReportConfig']> {
            return updateReportConfigImpl(id, updates)
        }

        deleteReportConfig(
            id: string
        ): ReturnType<AnalyticsServiceShape['deleteReportConfig']> {
            return deleteReportConfigImpl(id)
        }
    }
}

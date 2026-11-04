import { Context, Effect } from "effect";

import { coreDomainEventEnvelopeSchema } from "@deployer/contracts-entities";
import { isRecord } from "@deployer/type-guards";

import { attempt } from "../../../core/effects";
import type { DeploymentLogsPort, ProjectorOutboxPort } from "../deployment.ports";

export type DeploymentReadModelProjection = {
    deploymentId: string;
    lastEventId: string;
    lastEventType: string;
    lastOccurredAt: string;
    lastLogId: string | null;
    lastLevel: string | null;
    lastPhase: string | null;
    lastStep: string | null;
    updatedAt: string;
}

export type DeploymentProjectionDriftReport = {
    deploymentId: string;
    driftDetected: boolean;
    reason: "projection_missing" | "source_log_missing" | "last_log_mismatch" | null;
    projectionLogId: string | null;
    sourceLogId: string | null;
}

/** Every method fails only with whatever the outbox or the deployment's log store refused with (left as thrown). */
export type DeploymentReadModelProjectorServiceShape = {
    /** Folds the next batch of lifecycle events into the projections; resolves to how many it applied. */
    readonly processOutboxBatch: (limit?: number) => Effect.Effect<number, unknown>;
    /** Forgets every projection and replays the outbox from the start; resolves to how many events it applied. */
    readonly rebuildAll: () => Effect.Effect<number, unknown>;
    readonly getProjection: (deploymentId: string) => Effect.Effect<DeploymentReadModelProjection | null>;
    readonly getAllProjections: () => Effect.Effect<DeploymentReadModelProjection[]>;
    /** Compares a deployment's projection with the latest log row it was derived from. */
    readonly detectDrift: (deploymentId: string) => Effect.Effect<DeploymentProjectionDriftReport, unknown>;
};

export type DeploymentReadModelProjectorPorts = {
    readonly outbox: Context.Service.Shape<typeof ProjectorOutboxPort>;
    readonly logs: Context.Service.Shape<typeof DeploymentLogsPort>;
};

export class DeploymentReadModelProjectorService extends Context.Service<
    DeploymentReadModelProjectorService,
    DeploymentReadModelProjectorServiceShape
>()("runtime/DeploymentReadModelProjectorService") {}

/** Builds the projector over its ports; the projections and the outbox cursor live in this closure. */
export function makeDeploymentReadModelProjector(
    ports: DeploymentReadModelProjectorPorts,
): DeploymentReadModelProjectorServiceShape {
    const projections = new Map<string, DeploymentReadModelProjection>();
    let lastProcessedCreatedAt: Date | null = null;

    const processOutboxBatch = (limit = 200): Effect.Effect<number, unknown> =>
        Effect.gen(function* () {
            const rows = yield* attempt(() =>
                ports.outbox.findByTopic("deployment.lifecycle", {
                    states: ["pending", "sent"],
                    afterCreatedAt: lastProcessedCreatedAt,
                    limit,
                }),
            );

            let processed = 0;

            for (const row of rows) {
                const parsed = coreDomainEventEnvelopeSchema.safeParse(row.payload);
                if (!parsed.success) {
                    continue;
                }

                if (parsed.data.aggregateType !== "deployment") {
                    continue;
                }

                const payload = isRecord(parsed.data.payload) ? parsed.data.payload : {};

                projections.set(parsed.data.aggregateId, {
                    deploymentId: parsed.data.aggregateId,
                    lastEventId: parsed.data.eventId,
                    lastEventType: parsed.data.eventType,
                    lastOccurredAt: parsed.data.occurredAt,
                    lastLogId: typeof payload.logId === "string" ? payload.logId : null,
                    lastLevel: typeof payload.level === "string" ? payload.level : null,
                    lastPhase: typeof payload.phase === "string" ? payload.phase : null,
                    lastStep: typeof payload.step === "string" ? payload.step : null,
                    updatedAt: new Date().toISOString(),
                });

                lastProcessedCreatedAt = row.createdAt;
                processed += 1;
            }

            return processed;
        });

    const rebuildAll = (): Effect.Effect<number, unknown> =>
        Effect.gen(function* () {
            projections.clear();
            lastProcessedCreatedAt = null;

            let total = 0;
            while (true) {
                const count = yield* processOutboxBatch(500);
                total += count;
                if (count === 0) {
                    break;
                }
            }

            return total;
        });

    const detectDrift = (deploymentId: string): Effect.Effect<DeploymentProjectionDriftReport, unknown> =>
        Effect.gen(function* () {
            const projection = projections.get(deploymentId) ?? null;

            if (!projection) {
                return {
                    deploymentId,
                    driftDetected: true,
                    reason: "projection_missing",
                    projectionLogId: null,
                    sourceLogId: null,
                };
            }

            const logs = yield* attempt(() => ports.logs.findLogs(deploymentId, 1, 0));
            const latestLog = logs[0] ?? null;

            if (!latestLog) {
                return {
                    deploymentId,
                    driftDetected: true,
                    reason: "source_log_missing",
                    projectionLogId: projection.lastLogId,
                    sourceLogId: null,
                };
            }

            if (projection.lastLogId !== latestLog.id) {
                return {
                    deploymentId,
                    driftDetected: true,
                    reason: "last_log_mismatch",
                    projectionLogId: projection.lastLogId,
                    sourceLogId: latestLog.id,
                };
            }

            return {
                deploymentId,
                driftDetected: false,
                reason: null,
                projectionLogId: projection.lastLogId,
                sourceLogId: latestLog.id,
            };
        });

    return {
        processOutboxBatch,
        rebuildAll,
        getProjection: (deploymentId) => Effect.sync(() => projections.get(deploymentId) ?? null),
        getAllProjections: () => Effect.sync(() => [...projections.values()]),
        detectDrift,
    };
}

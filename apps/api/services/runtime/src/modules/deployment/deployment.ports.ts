import { Context } from 'effect'

import type { EnvService } from '@deployer/shared/config/env/env.module'
import type { LocalEventOutboxRepositoryShape } from '@deployer/shared/core/modules/events/outbox/local-event-outbox.repository'

import type { DeploymentRepository } from './repositories/deployment.repository'
import type { DeploymentServiceShape } from './services/deployment.service'

/**
 * What the queue, event and stream services depend on and have no Effect version of yet, as ports over
 * Promise-based Nest providers. The deployment module binds each tag with `useExisting`, so a service
 * asks for exactly the methods it calls and the deployment core (`DeploymentRepository`) can be migrated later by rebinding the tag, without touching a consumer.
 */

/** The deployment's log rows, which the read-model projector compares its projection against. */
export class DeploymentLogsPort extends Context.Service<
    DeploymentLogsPort,
    Pick<DeploymentRepository, 'findLogs'>
>()('runtime/DeploymentLogsPort') {}

/** The deployment rows startup reconciliation scans and settles. */
export class OrphanedDeploymentsPort extends Context.Service<
    OrphanedDeploymentsPort,
    Pick<DeploymentRepository, 'findMany' | 'updateStatus' | 'insertLog'>
>()('runtime/OrphanedDeploymentsPort') {}

/** The queue operations the worker drives through the deployment service (they also update the deployment). */
export class QueueDeploymentsPort extends Context.Service<
    QueueDeploymentsPort,
    Pick<
        DeploymentServiceShape,
        | 'claimQueueJobByIdempotencyKey'
        | 'heartbeatQueueJob'
        | 'completeQueueJob'
        | 'failQueueJob'
    >
>()('runtime/QueueDeploymentsPort') {}

/** The deployment's progress stream, served by the deployment service. */
export class DeploymentStreamsPort extends Context.Service<
    DeploymentStreamsPort,
    Pick<DeploymentServiceShape, 'streamDeploymentEvents'>
>()('runtime/DeploymentStreamsPort') {}

/** The local event outbox the read-model projector reads. */
export class ProjectorOutboxPort extends Context.Service<
    ProjectorOutboxPort,
    Pick<LocalEventOutboxRepositoryShape, 'findByTopic'>
>()('runtime/ProjectorOutboxPort') {}

/** The environment the queue worker reads its concurrency from. */
export class QueueEnvPort extends Context.Service<
    QueueEnvPort,
    Pick<EnvService, 'get'>
>()('runtime/QueueEnvPort') {}

/** The deployment rows and logs: the repository keeps its Promise API, so the deployment service and workflow reach it through this port. */
export class DeploymentRepositoryPort extends Context.Service<
    DeploymentRepositoryPort,
    DeploymentRepository
>()('runtime/DeploymentRepositoryPort') {}

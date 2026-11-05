import { Effect } from 'effect'
import z from 'zod/v4'

import {
    dockerodeServiceSummarySchema,
    dockerodeTaskSummarySchema,
    type DockerodeServiceSummary,
    type DockerodeTaskSummary,
} from '@deployer/contracts-entities'
import type { SwarmServiceSpecInput } from '@deployer/contracts-entities'

import { engineCall } from '../call'

import { toDockerServiceSpec } from './swarm-spec.mapper'

import type { DockerError } from '../../errors/errors'
import type Docker from 'dockerode'

export type SwarmServicesShape = {
    /** The service as the engine reports it; `DockerNotFound` when there is none. */
    readonly inspect: (
        idOrName: string
    ) => Effect.Effect<DockerodeServiceSummary, DockerError>
    readonly create: (
        spec: Docker.ServiceSpec
    ) => Effect.Effect<DockerodeServiceSummary, DockerError>
    /**
     * Applies `spec` to the service. `version` must be the service's current `Version.Index` (from
     * `inspect`). The engine answers with warnings, not a service: inspect again for the new state.
     */
    readonly update: (
        idOrName: string,
        version: number,
        spec: Docker.ServiceSpec,
        rollback?: boolean
    ) => Effect.Effect<void, DockerError>
    /** Removes the service, draining its tasks. One that is already gone counts as removed. */
    readonly remove: (idOrName: string) => Effect.Effect<void, DockerError>
    /** Sets the replica count (floored, never below zero). */
    readonly scale: (
        idOrName: string,
        replicas: number
    ) => Effect.Effect<void, DockerError>
    /** Re-applies the service's own `RollbackConfig` target, the previous good spec. */
    readonly rollback: (idOrName: string) => Effect.Effect<void, DockerError>
    readonly listTasks: (
        idOrName: string
    ) => Effect.Effect<DockerodeTaskSummary[], DockerError>
    /**
     * Makes the service match `spec`: updated in place when it exists, created when it does not.
     * Concurrent writers make the engine refuse an update with "out of sequence"; that is retried
     * against a fresh version, up to `maxAttempts` (default 5).
     */
    readonly reconcile: (
        spec: SwarmServiceSpecInput,
        maxAttempts?: number
    ) => Effect.Effect<void, DockerError>
    /** Every swarm service on the cluster (`GET /services`). */
    readonly list: () => Effect.Effect<DockerodeServiceSummary[], DockerError>
    /** Tasks cluster-wide (`GET /tasks`), optionally narrowed to a service and/or a node. */
    readonly listAllTasks: (filter?: {
        serviceId?: string
        nodeId?: string
    }) => Effect.Effect<DockerodeTaskSummary[], DockerError>
    /**
     * Tail of the service's aggregated task logs. Empty when the engine has none yet or cannot
     * answer: log replay is a convenience, never a gate.
     */
    readonly logs: (
        idOrName: string,
        options?: Docker.ContainerLogsOptions
    ) => Effect.Effect<string>
}

/** The part of an inspected service that scale and rollback rewrite. */
const serviceVersionAndSpecSchema = z.object({
    Version: z.object({ Index: z.number() }),
    Spec: z.record(z.string(), z.unknown()),
})

/** The engine refused an update because another writer got there first (stale `Version.Index`). */
export function isSwarmVersionConflict(error: unknown): boolean {
    return /update out of sequence/i.test(
        error instanceof Error ? error.message : String(error)
    )
}

export function makeSwarmServices(client: Docker): SwarmServicesShape {
    const resource = (idOrName: string) => `swarm service '${idOrName}'`

    const inspect: SwarmServicesShape['inspect'] = Effect.fn(
        'DockerSwarmServices.inspect'
    )(function* (idOrName) {
        return yield* engineCall(
            `inspect Swarm service ${idOrName}`,
            async () =>
                dockerodeServiceSummarySchema.parse(
                    await client.getService(idOrName).inspect()
                ),
            resource(idOrName)
        )
    })

    const create: SwarmServicesShape['create'] = Effect.fn(
        'DockerSwarmServices.create'
    )(function* (spec) {
        return yield* engineCall('create Swarm service', async () =>
            dockerodeServiceSummarySchema.parse(
                await client.createService(spec)
            )
        )
    })

    const update: SwarmServicesShape['update'] = Effect.fn(
        'DockerSwarmServices.update'
    )(function* (idOrName, version, spec, rollback = false) {
        yield* engineCall(
            `update Swarm service ${idOrName}`,
            () =>
                client.getService(idOrName).update({
                    version,
                    ...(rollback ? { rollback: true } : {}),
                    ...spec,
                }),
            resource(idOrName)
        )
    })

    const remove: SwarmServicesShape['remove'] = Effect.fn(
        'DockerSwarmServices.remove'
    )(function* (idOrName) {
        yield* engineCall(
            `remove Swarm service ${idOrName}`,
            () => client.getService(idOrName).remove(),
            resource(idOrName)
        ).pipe(Effect.catchTag('DockerNotFound', () => Effect.void))
        yield* Effect.logInfo(`Removed Swarm service ${idOrName}`)
    })

    const scale: SwarmServicesShape['scale'] = Effect.fn(
        'DockerSwarmServices.scale'
    )(function* (idOrName, replicas) {
        const target = Math.max(0, Math.floor(replicas))
        yield* engineCall(
            `scale Swarm service ${idOrName}`,
            async () => {
                const service = client.getService(idOrName)
                const current = serviceVersionAndSpecSchema.parse(
                    await service.inspect()
                )
                await service.update({
                    version: current.Version.Index,
                    ...current.Spec,
                    Mode: { Replicated: { Replicas: target } },
                })
            },
            resource(idOrName)
        )
        yield* Effect.logInfo(
            `Scaled Swarm service ${idOrName} → ${String(target)} replicas`
        )
    })

    const rollback: SwarmServicesShape['rollback'] = Effect.fn(
        'DockerSwarmServices.rollback'
    )(function* (idOrName) {
        yield* engineCall(
            `roll back Swarm service ${idOrName}`,
            async () => {
                const service = client.getService(idOrName)
                const current = serviceVersionAndSpecSchema.parse(
                    await service.inspect()
                )
                await service.update({
                    version: current.Version.Index,
                    rollback: true,
                    ...current.Spec,
                })
            },
            resource(idOrName)
        )
        yield* Effect.logInfo(`Rolled back Swarm service ${idOrName}`)
    })

    const listTasks: SwarmServicesShape['listTasks'] = Effect.fn(
        'DockerSwarmServices.listTasks'
    )(function* (idOrName) {
        return yield* engineCall(
            `list tasks for Swarm service ${idOrName}`,
            async () =>
                z.array(dockerodeTaskSummarySchema).parse(
                    await client.listTasks({
                        filters: { service: [idOrName] },
                    })
                )
        )
    })

    const list: SwarmServicesShape['list'] = Effect.fn(
        'DockerSwarmServices.list'
    )(function* () {
        return yield* engineCall('list Swarm services', async () =>
            z
                .array(dockerodeServiceSummarySchema)
                .parse(await client.listServices())
        )
    })

    const listAllTasks: SwarmServicesShape['listAllTasks'] = Effect.fn(
        'DockerSwarmServices.listAllTasks'
    )(function* (filter) {
        const filters: Record<string, string[]> = {}
        if (filter?.serviceId) filters.service = [filter.serviceId]
        if (filter?.nodeId) filters.node = [filter.nodeId]
        return yield* engineCall('list Swarm tasks', async () =>
            z
                .array(dockerodeTaskSummarySchema)
                .parse(await client.listTasks({ filters }))
        )
    })

    const logs: SwarmServicesShape['logs'] = Effect.fn(
        'DockerSwarmServices.logs'
    )(function* (
        idOrName,
        options = { stdout: true, stderr: true, tail: 200 }
    ) {
        return yield* engineCall(
            `read logs of Swarm service ${idOrName}`,
            async () => {
                const raw: unknown = await client
                    .getService(idOrName)
                    .logs({ ...options, follow: false })
                return typeof raw === 'string' ? raw : String(raw)
            }
        ).pipe(Effect.catch(() => Effect.succeed('')))
    })

    const reconcile: SwarmServicesShape['reconcile'] = Effect.fn(
        'DockerSwarmServices.reconcile'
    )(function* (spec, maxAttempts = 5) {
        const dockerSpec = toDockerServiceSpec(spec)
        for (let attempt = 1; ; attempt += 1) {
            const outcome = yield* inspect(spec.name).pipe(
                Effect.flatMap((existing) =>
                    update(spec.name, existing.Version.Index, dockerSpec, false)
                ),
                Effect.map(() => 'done' as const),
                Effect.catchTag('DockerNotFound', () =>
                    create(dockerSpec).pipe(Effect.map(() => 'done' as const))
                ),
                Effect.catch((failure) =>
                    attempt < maxAttempts && isSwarmVersionConflict(failure)
                        ? Effect.succeed('retry' as const)
                        : Effect.fail(failure)
                )
            )
            if (outcome === 'done') return
        }
    })

    return {
        inspect,
        create,
        update,
        remove,
        scale,
        rollback,
        listTasks,
        list,
        listAllTasks,
        logs,
        reconcile,
    }
}

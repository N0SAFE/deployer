import { Context, Effect } from 'effect'

import type { DockerEntityStreamChunk } from '@deployer/contracts-entities'
import type {
    DockerEntityInspectInput,
    DockerEntityListInput,
} from '@deployer/runtime-contracts/modules/docker/entity/shared'

import {
    DockerEntityOrchestratorService,
    type DockerEntityListResult,
} from './docker-entity-orchestrator.service'
import type {
    DockerEntityDomainPorts,
    DockerEntityDomainService,
} from './docker-entity-domain.service'

/** Everything a read leaves open: the orchestrator it goes through, and the domain that orchestrator reads. */
type EntityReadRequirements =
    | DockerEntityOrchestratorService
    | DockerEntityDomainService
    | DockerEntityDomainPorts

/**
 * The entity facade a handler may call, as an Effect service.
 *
 * Each operation IS the logic: it yields `DockerEntityOrchestratorService` and returns what that read produced. The
 * handler declares `DockerEntity` in its `R`, so the requirement gate audits the dependency.
 */
export type DockerEntityShape = {
    readonly listContainers: (
        input: DockerEntityListInput
    ) => Effect.Effect<
        DockerEntityListResult<'container'>,
        unknown,
        EntityReadRequirements
    >
    readonly listImages: (
        input: DockerEntityListInput
    ) => Effect.Effect<
        DockerEntityListResult<'image'>,
        unknown,
        EntityReadRequirements
    >
    readonly listNetworks: (
        input: DockerEntityListInput
    ) => Effect.Effect<
        DockerEntityListResult<'network'>,
        unknown,
        EntityReadRequirements
    >
    readonly listVolumes: (
        input: DockerEntityListInput
    ) => Effect.Effect<
        DockerEntityListResult<'volume'>,
        unknown,
        EntityReadRequirements
    >
    readonly inspectContainer: (
        input: DockerEntityInspectInput
    ) => Effect.Effect<
        DockerEntityStreamChunk | null,
        unknown,
        EntityReadRequirements
    >
    readonly inspectImage: (
        input: DockerEntityInspectInput
    ) => Effect.Effect<
        DockerEntityStreamChunk | null,
        unknown,
        EntityReadRequirements
    >
    readonly inspectNetwork: (
        input: DockerEntityInspectInput
    ) => Effect.Effect<
        DockerEntityStreamChunk | null,
        unknown,
        EntityReadRequirements
    >
    readonly inspectVolume: (
        input: DockerEntityInspectInput
    ) => Effect.Effect<
        DockerEntityStreamChunk | null,
        unknown,
        EntityReadRequirements
    >
}

/** Everything a caller must be able to see for these calls to run. */
export type DockerEntityPorts = EntityReadRequirements | DockerEntityDomainPorts

export class DockerEntity extends Context.Service<
    DockerEntity,
    DockerEntityShape
>()('runtime/DockerEntity') {
    static readonly live = class DockerEntityImpl implements DockerEntityShape {
        listContainers(
            input: DockerEntityListInput
        ): ReturnType<DockerEntityShape['listContainers']> {
            return Effect.gen(function* () {
                const entities = yield* DockerEntityOrchestratorService
                return yield* entities.listContainers(input)
            })
        }

        listImages(
            input: DockerEntityListInput
        ): ReturnType<DockerEntityShape['listImages']> {
            return Effect.gen(function* () {
                const entities = yield* DockerEntityOrchestratorService
                return yield* entities.listImages(input)
            })
        }

        listNetworks(
            input: DockerEntityListInput
        ): ReturnType<DockerEntityShape['listNetworks']> {
            return Effect.gen(function* () {
                const entities = yield* DockerEntityOrchestratorService
                return yield* entities.listNetworks(input)
            })
        }

        listVolumes(
            input: DockerEntityListInput
        ): ReturnType<DockerEntityShape['listVolumes']> {
            return Effect.gen(function* () {
                const entities = yield* DockerEntityOrchestratorService
                return yield* entities.listVolumes(input)
            })
        }

        inspectContainer(
            input: DockerEntityInspectInput
        ): ReturnType<DockerEntityShape['inspectContainer']> {
            return Effect.gen(function* () {
                const entities = yield* DockerEntityOrchestratorService
                return yield* entities.inspectContainer(input)
            })
        }

        inspectImage(
            input: DockerEntityInspectInput
        ): ReturnType<DockerEntityShape['inspectImage']> {
            return Effect.gen(function* () {
                const entities = yield* DockerEntityOrchestratorService
                return yield* entities.inspectImage(input)
            })
        }

        inspectNetwork(
            input: DockerEntityInspectInput
        ): ReturnType<DockerEntityShape['inspectNetwork']> {
            return Effect.gen(function* () {
                const entities = yield* DockerEntityOrchestratorService
                return yield* entities.inspectNetwork(input)
            })
        }

        inspectVolume(
            input: DockerEntityInspectInput
        ): ReturnType<DockerEntityShape['inspectVolume']> {
            return Effect.gen(function* () {
                const entities = yield* DockerEntityOrchestratorService
                return yield* entities.inspectVolume(input)
            })
        }
    }
}

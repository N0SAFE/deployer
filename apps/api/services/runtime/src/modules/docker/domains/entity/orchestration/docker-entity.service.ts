import { Context } from 'effect'

import { serviceOver, type Over } from '@deployer/effect-core'
import type {
    DockerEntityInspectInput,
    DockerEntityListInput,
} from '@deployer/runtime-contracts/modules/docker/entity/shared'

import {
    DockerEntityOrchestratorService,
    type DockerEntityOrchestratorPorts,
} from './docker-entity-orchestrator.service'

/**
 * The entity facade a handler may call, as an Effect service.
 *
 * It delegates to `DockerEntityOrchestratorService`, whose constant methods yield their collaborators when they run.
 * The handler declares `DockerEntity` in its `R`, so the requirement gate audits the dependency.
 */
export type DockerEntityShape = {
    readonly listContainers: (
        input: DockerEntityListInput
    ) => ReturnType<DockerEntityOrchestratorService['listContainers']>
    readonly listImages: (
        input: DockerEntityListInput
    ) => ReturnType<DockerEntityOrchestratorService['listImages']>
    readonly listNetworks: (
        input: DockerEntityListInput
    ) => ReturnType<DockerEntityOrchestratorService['listNetworks']>
    readonly listVolumes: (
        input: DockerEntityListInput
    ) => ReturnType<DockerEntityOrchestratorService['listVolumes']>
    readonly inspectContainer: (
        input: DockerEntityInspectInput
    ) => ReturnType<DockerEntityOrchestratorService['inspectContainer']>
    readonly inspectImage: (
        input: DockerEntityInspectInput
    ) => ReturnType<DockerEntityOrchestratorService['inspectImage']>
    readonly inspectNetwork: (
        input: DockerEntityInspectInput
    ) => ReturnType<DockerEntityOrchestratorService['inspectNetwork']>
    readonly inspectVolume: (
        input: DockerEntityInspectInput
    ) => ReturnType<DockerEntityOrchestratorService['inspectVolume']>
}

/** Everything a caller must be able to see for these calls to run. */
export type DockerEntityPorts =
    DockerEntityOrchestratorService | DockerEntityOrchestratorPorts

export class DockerEntity extends Context.Service<
    DockerEntity,
    Over<DockerEntityShape, DockerEntityPorts>
>()('runtime/DockerEntity') {
    /** Stateless: the orchestrator is resolved on every call. */
    static readonly live: Over<DockerEntityShape, DockerEntityPorts> =
        serviceOver(
            DockerEntityOrchestratorService,
            (entities): DockerEntityShape => ({
                listContainers: (input) => entities.listContainers(input),
                listImages: (input) => entities.listImages(input),
                listNetworks: (input) => entities.listNetworks(input),
                listVolumes: (input) => entities.listVolumes(input),
                inspectContainer: (input) => entities.inspectContainer(input),
                inspectImage: (input) => entities.inspectImage(input),
                inspectNetwork: (input) => entities.inspectNetwork(input),
                inspectVolume: (input) => entities.inspectVolume(input),
            })
        )
}

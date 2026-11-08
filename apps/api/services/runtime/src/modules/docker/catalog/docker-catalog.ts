import { Context, Effect } from 'effect'

import type { DockerRuntimeCatalog } from '@deployer/contracts-entities'
import type { DockerNetworkListInput } from '@deployer/runtime-contracts/modules/docker/networks/list'
import type { DockerVolumeListInput } from '@deployer/runtime-contracts/modules/docker/volumes/list'

import { formatError } from '../domains/containers/orchestration/mesh-entity-normalization'
import { mergeRuntimeCatalogResponses } from '../domains/containers/orchestration/mesh-universe-merge'

import { listNetworksOf, listVolumesOf } from './catalog-lists'

import type { DockerNodeMesh } from '../domains/containers/mesh/docker-node-mesh'
import type { DockerRepository } from '../repositories/facade/docker.repository'

/** The mesh fan-out that collects every node's runtime catalog (a Promise-based Nest provider until it moves). */
export class CatalogMeshPort extends Context.Service<
    CatalogMeshPort,
    Pick<DockerNodeMesh, 'listRuntimeCatalogAcrossInstances'>
>()('runtime/CatalogMeshPort') {}

/** This node's own catalog, read from the local engine. */
export class CatalogLocalPort extends Context.Service<
    CatalogLocalPort,
    Pick<DockerRepository, 'getRuntimeCatalogSnapshot'>
>()('runtime/CatalogLocalPort') {}

export type DockerCatalogPorts = CatalogMeshPort | CatalogLocalPort

export type DockerCatalogShape = {
    /** The runtime catalog of the whole mesh, or this node's own when no peer answers or the fan-out fails. */
    readonly resolve: () => Effect.Effect<
        DockerRuntimeCatalog,
        unknown,
        DockerCatalogPorts
    >
    readonly listNetworks: (
        input: DockerNetworkListInput
    ) => Effect.Effect<
        ReturnType<typeof listNetworksOf>,
        unknown,
        DockerCatalogPorts
    >
    readonly listVolumes: (
        input: DockerVolumeListInput
    ) => Effect.Effect<
        ReturnType<typeof listVolumesOf>,
        unknown,
        DockerCatalogPorts
    >
}

const MESH_CATALOG_TIMEOUT_MS = 2_000
const MESH_CATALOG_MAX_RESPONSES = 128

/**
 * The runtime catalog across the mesh: networks, volumes and the catalog itself.
 *
 * The mesh fan-out and the local repository are yielded where a method needs them; `listNetworks` and `listVolumes`
 * call `resolve`, so they inherit its requirements and yield nothing extra.
 */
export class DockerCatalog extends Context.Service<
    DockerCatalog,
    DockerCatalogShape
>()('runtime/DockerCatalog') {
    static readonly live = class DockerCatalogImpl implements DockerCatalogShape {
        resolve(): ReturnType<DockerCatalogShape['resolve']> {
            return Effect.gen({ self: this }, function* () {
                const mesh = yield* CatalogMeshPort
                const local = yield* CatalogLocalPort
                const fromLocal = Effect.tryPromise({
                    try: async () => await local.getRuntimeCatalogSnapshot(),
                    catch: (error) => error,
                })

                return yield* Effect.tryPromise({
                    try: async () =>
                        await mesh.listRuntimeCatalogAcrossInstances(
                            {},
                            {
                                timeoutMs: MESH_CATALOG_TIMEOUT_MS,
                                maxCollectedResponses:
                                    MESH_CATALOG_MAX_RESPONSES,
                            }
                        ),
                    catch: (error) => error,
                }).pipe(
                    Effect.flatMap((meshResult) =>
                        meshResult.responses.length === 0
                            ? fromLocal
                            : Effect.try({
                                  try: () =>
                                      mergeRuntimeCatalogResponses(
                                          meshResult.responses
                                      ),
                                  catch: (error) => error,
                              })
                    ),
                    Effect.catchIf(
                        () => true,
                        (error) =>
                            Effect.logWarning(
                                `Mesh runtime catalog resolution failed (${formatError(error)}). Falling back to local repository`
                            ).pipe(Effect.andThen(fromLocal))
                    )
                )
            })
        }

        listNetworks(
            input: DockerNetworkListInput
        ): ReturnType<DockerCatalogShape['listNetworks']> {
            return Effect.gen({ self: this }, function* () {
                const catalog = yield* this.resolve()
                return listNetworksOf(catalog, input)
            })
        }

        listVolumes(
            input: DockerVolumeListInput
        ): ReturnType<DockerCatalogShape['listVolumes']> {
            return Effect.gen({ self: this }, function* () {
                const catalog = yield* this.resolve()
                return listVolumesOf(catalog, input)
            })
        }
    }
}

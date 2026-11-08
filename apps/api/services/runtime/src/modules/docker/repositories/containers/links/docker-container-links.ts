import { Context, Effect } from 'effect'

import type {
    DockerContainer,
    DockerContainerLinkPath,
    DockerContainerWithLinks,
} from '@deployer/contracts-entities'
import type { DbError } from '@deployer/effect-infra'

import {
    assembleContainerLinks,
    inclusionOf,
    withoutLinks,
} from './container-link-assembly'
import { DockerContainerLinksLookup } from './docker-container-links-lookup.repository'

import type {
    RuntimeDatabasePort,
    RuntimeDb,
} from '../../../../../core/database/runtime-db'

export type DockerContainerLinksShape = {
    /**
     * The containers with their deployment, service and project links, redacted for the caller's platform role.
     * Reads the database only when an include path asks for a link.
     */
    readonly attach: (
        containers: readonly DockerContainer[],
        includePaths: readonly DockerContainerLinkPath[],
        platformRole: string | null
    ) => Effect.Effect<
        DockerContainerWithLinks[],
        DbError,
        RuntimeDb | RuntimeDatabasePort | DockerContainerLinksLookup
    >
}

/**
 * Container links for the linked-containers list.
 *
 * The scope decision IS the logic: nothing asked for is answered without a query, and only a real link request yields
 * the lookup (and, through it, the database).
 */
export class DockerContainerLinks extends Context.Service<
    DockerContainerLinks,
    DockerContainerLinksShape
>()('runtime/DockerContainerLinks') {
    static readonly live = class DockerContainerLinksImpl
        implements DockerContainerLinksShape
    {
        attach(
            containers: readonly DockerContainer[],
            includePaths: readonly DockerContainerLinkPath[],
            platformRole: string | null
        ): ReturnType<DockerContainerLinksShape['attach']> {
            if (containers.length === 0) {
                return Effect.succeed([])
            }
            const include = inclusionOf(includePaths)
            if (!include.deployment && !include.service && !include.project) {
                return Effect.succeed(withoutLinks(containers))
            }
            return Effect.gen(function* () {
                const lookup = yield* DockerContainerLinksLookup
                const rows = yield* lookup.lookup(containers, include)
                return assembleContainerLinks(
                    containers,
                    include,
                    platformRole,
                    rows
                )
            })
        }
    }
}

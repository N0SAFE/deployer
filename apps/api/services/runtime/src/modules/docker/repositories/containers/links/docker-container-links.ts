import { Context, Effect } from 'effect'

import type {
    DockerContainer,
    DockerContainerLinkPath,
    DockerContainerWithLinks,
} from '@deployer/contracts-entities'
import { serviceOver, type Over } from '@deployer/effect-core'
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

const makeDockerContainerLinks = ({
    lookup,
}: {
    lookup: DockerContainerLinksLookup['Service']
}): DockerContainerLinksShape => ({
    attach: (containers, includePaths, platformRole) => {
        if (containers.length === 0) {
            return Effect.succeed([])
        }
        const include = inclusionOf(includePaths)
        if (!include.deployment && !include.service && !include.project) {
            return Effect.succeed(withoutLinks(containers))
        }
        return Effect.map(lookup.lookup(containers, include), (rows) =>
            assembleContainerLinks(containers, include, platformRole, rows)
        )
    },
})

/** Container links for the linked-containers list; a constant that reads the lookup from the Effect context when it runs. */
export class DockerContainerLinks extends Context.Service<
    DockerContainerLinks,
    Over<DockerContainerLinksShape, DockerContainerLinksLookup>
>()('runtime/DockerContainerLinks') {
    static readonly live = serviceOver(
        Effect.all({ lookup: DockerContainerLinksLookup }),
        makeDockerContainerLinks
    )
}

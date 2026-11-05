import { eq, inArray } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import type { DockerContainer } from '@deployer/contracts-entities'
import type { DbError } from '@deployer/effect-infra'
import {
    projects,
    services,
} from '@deployer/nest-schema/global/project/deployment'
import { deployments } from '@deployer/nest-schema/global/runtime/deployment'

import {
    RuntimeDatabasePort,
    RuntimeDb,
} from '../../../../../core/database/runtime-db'

import {
    collectContainerLinkIds,
    type ContainerLinkRows,
    type LinkInclusion,
} from './container-link-assembly'

export type DockerContainerLinksLookupShape = {
    /** The deployment, service and project rows the containers link to, found in that order (each step adds the next ids). */
    readonly lookup: (
        containers: readonly DockerContainer[],
        include: LinkInclusion
    ) => Effect.Effect<
        ContainerLinkRows,
        DbError,
        RuntimeDb | RuntimeDatabasePort
    >
}

/** Reads what containers link to; a constant that takes the database from the Effect context when it runs. */
export class DockerContainerLinksLookup extends Context.Service<
    DockerContainerLinksLookup,
    DockerContainerLinksLookupShape
>()('runtime/DockerContainerLinksLookup') {
    static readonly live = class DockerContainerLinksLookupImpl implements DockerContainerLinksLookupShape {
        lookup = (containers, include) =>
            Effect.gen(function* () {
                const database = yield* RuntimeDb
                const ids = collectContainerLinkIds(containers, include)

                const deploymentRows =
                    ids.deploymentIds.size === 0
                        ? []
                        : yield* database.use((db) =>
                              db
                                  .select({
                                      id: deployments.id,
                                      serviceId: deployments.serviceId,
                                      projectId: services.projectId,
                                      environment: deployments.environment,
                                      status: deployments.status,
                                      containerName: deployments.containerName,
                                      containerImage:
                                          deployments.containerImage,
                                      domainUrl: deployments.domainUrl,
                                      healthCheckUrl:
                                          deployments.healthCheckUrl,
                                      createdAt: deployments.createdAt,
                                      updatedAt: deployments.updatedAt,
                                  })
                                  .from(deployments)
                                  .innerJoin(
                                      services,
                                      eq(services.id, deployments.serviceId)
                                  )
                                  .where(
                                      inArray(deployments.id, [
                                          ...ids.deploymentIds,
                                      ])
                                  )
                          )

                if (include.service)
                    for (const row of deploymentRows)
                        ids.serviceIds.add(row.serviceId)
                if (include.project)
                    for (const row of deploymentRows)
                        ids.projectIds.add(row.projectId)

                const serviceRows =
                    ids.serviceIds.size === 0
                        ? []
                        : yield* database.use((db) =>
                              db
                                  .select({
                                      id: services.id,
                                      projectId: services.projectId,
                                      name: services.name,
                                      type: services.type,
                                      isActive: services.isActive,
                                      updatedAt: services.updatedAt,
                                      customDomains: services.customDomains,
                                      resourceLimits: services.resourceLimits,
                                      environmentVariables:
                                          services.environmentVariables,
                                  })
                                  .from(services)
                                  .where(
                                      inArray(services.id, [...ids.serviceIds])
                                  )
                          )

                if (include.project)
                    for (const row of serviceRows)
                        ids.projectIds.add(row.projectId)

                const projectRows =
                    ids.projectIds.size === 0
                        ? []
                        : yield* database.use((db) =>
                              db
                                  .select({
                                      id: projects.id,
                                      name: projects.name,
                                      baseDomain: projects.baseDomain,
                                      updatedAt: projects.updatedAt,
                                  })
                                  .from(projects)
                                  .where(
                                      inArray(projects.id, [...ids.projectIds])
                                  )
                          )

                return {
                    deployments: deploymentRows,
                    services: serviceRows,
                    projects: projectRows,
                }
            })
    }
}

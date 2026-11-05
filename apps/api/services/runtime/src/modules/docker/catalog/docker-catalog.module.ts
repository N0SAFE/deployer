import { createModuleContext } from '@deployer/nest-effect'

import { DockerContainersModule } from '../domains/containers/docker-containers.module'
import { DOCKER_NODE_MESH } from '../domains/containers/mesh/docker-node-mesh'
import { DockerRepositoriesModule } from '../repositories/docker-repositories.module'
import { DockerRepository } from '../repositories/facade/docker.repository'

import {
    CatalogLocalPort,
    CatalogMeshPort,
    DockerCatalog,
} from './docker-catalog'

/** The mesh-wide runtime catalog: the constant service and the two Nest providers it reads through ports. */
export class DockerCatalogModule extends createModuleContext({
    imports: [DockerContainersModule, DockerRepositoriesModule],
    providers: [
        { provide: CatalogMeshPort, useExisting: DOCKER_NODE_MESH },
        { provide: CatalogLocalPort, useExisting: DockerRepository },
        { provide: DockerCatalog, useValue: DockerCatalog.live },
    ],
    exports: [DockerCatalog, CatalogMeshPort, CatalogLocalPort],
}) {}

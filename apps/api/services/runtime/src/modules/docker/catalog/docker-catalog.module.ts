import { createModuleContext } from "@deployer/nest-effect";

import { DockerContainerMeshService } from "../domains/containers/mesh/docker-container-mesh.service";
import { DockerContainersModule } from "../domains/containers/docker-containers.module";
import { DockerRepository } from "../repositories/facade/docker.repository";
import { DockerRepositoriesModule } from "../repositories/docker-repositories.module";
import { CatalogLocalPort, CatalogMeshPort, DockerCatalog } from "./docker-catalog";

/** The mesh-wide runtime catalog: the constant service and the two Nest providers it reads through ports. */
export class DockerCatalogModule extends createModuleContext({
  imports: [DockerContainersModule, DockerRepositoriesModule],
  providers: [
    { provide: CatalogMeshPort, useExisting: DockerContainerMeshService },
    { provide: CatalogLocalPort, useExisting: DockerRepository },
    { provide: DockerCatalog, useValue: DockerCatalog.live },
  ],
  exports: [DockerCatalog],
}) {}

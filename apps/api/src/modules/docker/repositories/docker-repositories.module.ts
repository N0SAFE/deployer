import { Module } from "@nestjs/common";
import { DatabaseModule } from "@/core/modules/database/database.module";
import { CoreDockerModule } from "@/core/modules/docker/docker.module";
import { DockerRepository } from "./facade/docker.repository";
import { DockerContainerLinksRepository } from "./containers/links/docker-container-links.repository";
import { DockerImageCatalogRepository } from "./images/catalog/docker-image-catalog.repository";
import { DockerImageSecurityRepository } from "./images/security/docker-image-security.repository";
import { DockerRuntimeActivityRepository } from "./runtime/docker-runtime-activity.repository";

@Module({
  imports: [DatabaseModule, CoreDockerModule],
  providers: [
    DockerRepository,
    DockerContainerLinksRepository,
    DockerImageCatalogRepository,
    DockerImageSecurityRepository,
    DockerRuntimeActivityRepository,
  ],
  exports: [
    DockerRepository,
    DockerContainerLinksRepository,
    DockerImageCatalogRepository,
    DockerImageSecurityRepository,
    DockerRuntimeActivityRepository,
  ],
})
export class DockerRepositoriesModule {}
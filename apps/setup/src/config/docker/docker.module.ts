import { Logger } from "@nestjs/common";
import { createGlobalModule } from "@deployer/nest-effect";
import { DockerEngine, DockerHost, makeDockerHost, type DockerHostShape } from "@deployer/docker";

import { EnvModule, EnvService } from "@/config/env/env.module";

/**
 * The setup app's Docker wiring: the `@deployer/docker` host and engine, provided under the package's
 * own tags from this app's environment.
 *
 * Setup drives the engine (swarm init/join, service creation) but never scans images, so it provides
 * no scanner pool. Global because the engine is process-wide infrastructure that every phase reads.
 */
export const DockerModule = createGlobalModule({
  imports: [EnvModule],
  providers: [
    {
      provide: DockerHost,
      useFactory: (env: EnvService): DockerHostShape => {
        const logger = new Logger("DockerHost");
        const host = makeDockerHost({ host: env.get("DOCKER_HOST"), port: env.get("DOCKER_PORT") });
        for (const warning of host.warnings) logger.warn(warning);
        logger.log(`Configured Docker client via ${host.mode}`);
        return host;
      },
      inject: [EnvService],
    },
    { provide: DockerEngine, useFactory: (host: DockerHostShape) => host.engine, inject: [DockerHost] },
  ],
  exports: [DockerHost, DockerEngine],
});

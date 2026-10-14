import { Global, Module } from "@nestjs/common";
import {
  DockerService,
  PostgresServiceProvisioner,
  ScannerContainerManagerService,
  type DockerConnectionConfig,
  type ScannerConfig,
} from "@repo/nest-docker";

import { EnvModule, EnvService } from "@/config/env/env.module";

/**
 * CORE MODULE: Docker — the API's WIRING of the shared docker primitives.
 *
 * The package owns the behaviour (`@repo/nest-docker`); this module owns the
 * CONFIGURATION, reading this app's environment and handing each primitive the
 * narrow contract it declares. That split is why the package can be used by a
 * second app with different variables — it never reads an env var itself.
 *
 * `EnvModule` IS IMPORTED EXPLICITLY. The factories below inject `EnvService`,
 * so it must be resolvable from THIS module's scope. Importing only the
 * `EnvService` class (for its type) would compile fine and then fail at boot in
 * any container where `EnvModule` was not registered globally elsewhere — the
 * hidden coupling the `AppModule` graph check exists to surface.
 */

/** Defaults live HERE, not in the package: what scanner image to run is a deployment decision. */
const DEFAULT_SCANNER_RUNNER_IMAGE = "deployer-scanner-runner:latest";
const DEFAULT_SCANNER_APP_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

@Global()
@Module({
  imports: [EnvModule],
  providers: [
    {
      provide: DockerService,
      useFactory: (env: EnvService) => {
        const config: DockerConnectionConfig = {
          host: env.get("DOCKER_HOST"),
          port: env.get("DOCKER_PORT"),
        };
        return new DockerService(config);
      },
      inject: [EnvService],
    },
    {
      provide: ScannerContainerManagerService,
      useFactory: (docker: DockerService, env: EnvService) => {
        const config: ScannerConfig = {
          image: env.get("SCANNER_RUNNER_IMAGE") ?? DEFAULT_SCANNER_RUNNER_IMAGE,
          buildContext: env.get("SCANNER_RUNNER_BUILD_CONTEXT"),
          idleTimeoutMs: env.get("SCANNER_APP_IDLE_TIMEOUT_MS") ?? DEFAULT_SCANNER_APP_IDLE_TIMEOUT_MS,
          autoScanDisabled: env.get("DISABLE_AUTO_SCAN"),
        };
        return new ScannerContainerManagerService(docker, config);
      },
      inject: [DockerService, EnvService],
    },
    {
      // The provisioner needs only the engine: the Postgres IDENTITY is resolved
      // per provisioning call by the caller (`toPostgresIdentity` in the setup
      // service), because it depends on the deployment prefix decided at runtime.
      provide: PostgresServiceProvisioner,
      useFactory: (docker: DockerService) => new PostgresServiceProvisioner(docker),
      inject: [DockerService],
    },
  ],
  exports: [DockerService, ScannerContainerManagerService, PostgresServiceProvisioner],
})
export class CoreDockerModule {}

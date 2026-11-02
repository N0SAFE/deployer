import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";

import {
  DockerEngine,
  DockerHost,
  makeDockerHost,
  makePostgresProvisioner,
  makeScannerPool,
  PostgresProvisioner,
  ScannerPool,
  type DockerEngineShape,
  type DockerHostShape,
  type ScannerConfig,
  type ScannerPoolShape,
} from "@deployer/docker";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import { createGlobalModule } from "@deployer/nest-effect";

import { EnvModule, EnvService } from "../../../config/env/env.module";

/**
 * CORE MODULE: Docker — the API's WIRING of the `@deployer/docker` Effect services.
 *
 * The package owns the behaviour; this module owns the CONFIGURATION, reading this app's environment
 * and providing the host, the engine, the scanner pool and the Postgres provisioner under the
 * package's own tags. Callers inject the tag they need and run its Effects.
 *
 * `EnvModule` IS IMPORTED EXPLICITLY. The factories below inject `EnvService`, so it must be
 * resolvable from THIS module's scope rather than assumed to be registered globally elsewhere.
 */

/** Defaults live HERE, not in the package: what scanner image to run is a deployment decision. */
const DEFAULT_SCANNER_APP_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Stops the scanner containers this process started, when the context closes. */
@Injectable()
class ScannerPoolLifecycle implements OnModuleDestroy {
  constructor(@Inject(ScannerPool) private readonly pool: ScannerPoolShape) {}

  async onModuleDestroy(): Promise<void> {
    await runPromiseUnwrapped(this.pool.stopAll);
  }
}

export const CoreDockerModule = createGlobalModule({
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
    {
      provide: ScannerPool,
      useFactory: (host: DockerHostShape, env: EnvService): ScannerPoolShape => {
        const config: ScannerConfig = {
          // The schema gives it a default, so `env.get` is always a string: the fallback was dead code.
          image: env.get("SCANNER_RUNNER_IMAGE"),
          buildContext: env.get("SCANNER_RUNNER_BUILD_CONTEXT"),
          idleTimeoutMs: env.get("SCANNER_APP_IDLE_TIMEOUT_MS"),
          autoScanDisabled: env.get("DISABLE_AUTO_SCAN"),
        };
        return makeScannerPool({ docker: host.engine, config, access: host.scannerAccess });
      },
      inject: [DockerHost, EnvService],
    },
    ScannerPoolLifecycle,
    {
      // The provisioner needs only the engine: the Postgres IDENTITY is resolved per provisioning
      // call by the caller, because it depends on the deployment prefix decided at runtime.
      provide: PostgresProvisioner,
      useFactory: (engine: DockerEngineShape) => makePostgresProvisioner(engine),
      inject: [DockerEngine],
    },
  ],
  exports: [DockerHost, DockerEngine, ScannerPool, PostgresProvisioner],
});

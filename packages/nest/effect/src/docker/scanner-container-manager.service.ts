import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  DockerInvalid,
  makeScannerPool,
  type ScannerConfig,
  type ScannerEngineAccess,
  type ScannerExecResult,
  type ScannerPoolShape,
  type ScannerType,
} from "@deployer/docker";
import { AppError } from "@deployer/errors";
import { Cause, Effect, Exit } from "effect";
import { DockerService } from "./docker.service";

export type { ScannerExecResult, ScannerType };

/**
 * The Promise face of `ScannerPool` (in `@deployer/docker`), for the Nest callers that are not on
 * Effect yet. The pool keeps its state here, in this instance; `onModuleDestroy` stops the
 * containers it started.
 */
@Injectable()
export class ScannerContainerManagerService implements OnModuleDestroy {
  private readonly pool: ScannerPoolShape;

  constructor(dockerService: DockerService, config: ScannerConfig) {
    const access: ScannerEngineAccess = dockerService.getScannerEngineAccess();
    this.pool = makeScannerPool({ docker: dockerService.getEngine(), config, access });
  }

  ensureContainerRunning(scanner: ScannerType): Promise<boolean> {
    return Effect.runPromise(this.pool.ensureRunning(scanner));
  }

  async execInScanner(scanner: ScannerType, cmd: string[]): Promise<ScannerExecResult> {
    const exit = await Effect.runPromiseExit(this.pool.exec(scanner, cmd));
    if (Exit.isSuccess(exit)) {
      return exit.value;
    }
    const failure = Cause.squash(exit.cause);
    if (failure instanceof DockerInvalid) {
      throw new AppError(failure.message, "INTERNAL_ERROR");
    }
    throw failure;
  }

  stopContainer(scanner: ScannerType): Promise<void> {
    return Effect.runPromise(this.pool.stop(scanner));
  }

  stopAllContainers(): Promise<void> {
    return Effect.runPromise(this.pool.stopAll);
  }

  cleanStaleScannerImages(): Promise<void> {
    return Effect.runPromise(this.pool.cleanStaleImages);
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopAllContainers();
  }
}

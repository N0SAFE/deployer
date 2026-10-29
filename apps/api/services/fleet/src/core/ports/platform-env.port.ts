import type { EnvService } from "@deployer/shared/config/env/env.module";
import { Context } from "effect";

/** Effect view of the platform environment: the typed variables the service reads. */
export type PlatformEnvShape = Pick<EnvService, "get">;

export class PlatformEnv extends Context.Service<PlatformEnv, PlatformEnvShape>()("fleet/PlatformEnv") {}

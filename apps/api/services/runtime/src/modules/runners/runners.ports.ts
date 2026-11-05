import { Context } from "effect";

import type { EnvService } from "@deployer/shared/config/env/env.module";

/**
 * What the runners depend on and have no Effect version of yet, as ports over Promise-based providers.
 *
 * The docker engine is not here: `@deployer/docker` is Effect-native, so the runners use it directly.
 * The env is owned by shared packages and stay Promise-based Nest providers; the runners module registers each tag with `useExisting`, so a
 * runner asks for the port without importing Nest. A port is the seam a test replaces with a fake
 * and the place a collaborator is rewritten later without touching the runners.
 */
export class RunnerEnvPort extends Context.Service<RunnerEnvPort, EnvService>()("runtime/RunnerEnvPort") {}

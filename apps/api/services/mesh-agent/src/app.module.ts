import { createModuleContext, EffectRuntime, EffectRuntimeModule } from "@deployer/nest-effect";
import { AppLifecycleModule } from "@deployer/shared/core/modules/lifecycle/lifecycle.module";
import { PreflightModule, DEPENDENCIES, ServiceHealthModule, createMeshOrpcModule } from "@deployer/shared/server";

import { MeshAgentConfigModule } from "./config/mesh-agent-config.module";
import { MeshDomainModule } from "./modules/mesh/mesh.module";

/**
 * The mesh-agent service.
 *
 * Same anatomy as every service, with the two differences an agent needs:
 *   - no `DatabaseModule`, no `AuthModule`: an agent runs on every node before the swarm and its database exist;
 *   - `createMeshOrpcModule()` instead of `createOrpcModule()`: the transport policy is identical, and the caller is
 *     authenticated by the mesh credential instead of a Better Auth session.
 *
 * Imports only. A domain module owns the controllers and providers.
 */
export class MeshAgentServiceModule extends createModuleContext({
  imports: [
    MeshAgentConfigModule,
    AppLifecycleModule.forRoot(),
    PreflightModule.forRoot({ dependencies: DEPENDENCIES.none }),
    ServiceHealthModule,
    createMeshOrpcModule({
      extraContext: {
        inject: [EffectRuntime],
        resolve: async (runtime) => ({
          "effect/context": await runtime.context(),
        }),
      },
    }),
    EffectRuntimeModule,
    MeshDomainModule,
  ],
}) {}

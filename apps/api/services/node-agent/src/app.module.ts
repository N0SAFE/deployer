import {
	createModuleContext,
	EffectRuntimeModule,
	EffectHostModule,
	EffectHost,
} from "@deployer/nest-effect";
import { AppLifecycleModule } from "@deployer/shared/core/modules/lifecycle/lifecycle.module";
import { PreflightModule, DEPENDENCIES, ServiceHealthModule, createMeshOrpcModule } from "@deployer/shared/server";

import { AgentLocalModule } from "./local/agent-local.module";
import { MeshDomainModule } from "./modules/mesh/mesh.module";
import { NodeAgentTransportModule } from "./transport/mesh-transport.module";

/**
 * The node-agent service.
 *
 * Same anatomy as every service, with the two differences an agent needs:
 *   - no `DatabaseModule`, no `AuthModule`: an agent runs on every node before the swarm and its database exist;
 *   - `createMeshOrpcModule()` instead of `createOrpcModule()`: the transport policy is identical, and the caller is
 *     authenticated by the mesh credential instead of a Better Auth session.
 *
 * Imports only. A domain module owns the controllers and providers.
 */
export class NodeAgentServiceModule extends createModuleContext({
  imports: [
    AgentLocalModule,
    AppLifecycleModule.forRoot(),
    PreflightModule.forRoot({ dependencies: DEPENDENCIES.none }),
    ServiceHealthModule,
    EffectHostModule,
    createMeshOrpcModule({
      extraContext: {
        inject: [EffectHost],
        resolve: async (executionContext, host) => ({
          "effect/context": host.contextFor(executionContext.getClass()),
        }),
      },
    }),
    EffectRuntimeModule,
    // The host is how a boundary (the oRPC transport here, a loop elsewhere) reaches the runtime as a service.
    MeshDomainModule,
    NodeAgentTransportModule,
  ],
}) {}

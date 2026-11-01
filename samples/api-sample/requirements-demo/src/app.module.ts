import type { ExecutionContext } from "@nestjs/common";
import { ORPCModule } from "@orpc/nest";

import { createModuleContext, EffectRuntime, EffectRuntimeModule } from "./effect";
import { AuditModule } from "./modules/audit/audit.module";
import { ConsumerModule } from "./modules/consumer/consumer.module";
import { MeshDomainModule } from "./modules/mesh/mesh.module";
import { PlatformModule } from "./modules/platform/platform.module";

export const AppModule = createModuleContext({
	imports: [
		ORPCModule.forRootAsync({
			imports: [EffectRuntimeModule],
			inject: [EffectRuntime],
			// The request context is the context of the module that owns the controller being called.
			useFactory: (runtime: EffectRuntime) => ({
				context: (executionContext: ExecutionContext) => ({
					"effect/context": runtime.contextFor(executionContext.getClass()),
				}),
			}),
		}),
		EffectRuntimeModule,
		PlatformModule,
		AuditModule,
		MeshDomainModule,
		ConsumerModule,
	],
});

/**
 * The composition root: imports only.
 *
 * It registers the global platform module — a global must be imported *somewhere* — and resolves whatever its subtree
 * could not. Globals are subtracted here, at the only place that knows the whole tree.
 */

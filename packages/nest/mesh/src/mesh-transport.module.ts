import { Module, type DynamicModule } from "@nestjs/common";
import { DiscoveryModule, DiscoveryService } from "@nestjs/core";
import { declareModule } from "@deployer/nest-effect";

import { MeshRouterResolver } from "./mesh-router.resolver";
import { MESH_TRANSPORT_OPTIONS, type MeshTransportOptions } from "./mesh-transport.options";

/**
 * The routers the app declares, as a module.
 *
 * **It is not a class.** A `@Module({})` class can be written into an `imports: [...]` array without `forRoot`, and that
 * silently drops the contract validation (the options are what the doors are checked against). Here `forRoot` builds the
 * module, and the bare export is a plain object — writing `imports: [MeshTransportModule]` does not type-check, so the
 * mistake is a compile error instead of a runtime surprise.
 *
 * The dynamic module is created per call because the contract is per app; `declareModule` is the documented form for a
 * `forRoot` result.
 */
export const MeshTransportModule = {
	forRoot(options: MeshTransportOptions): DynamicModule {
		@Module({})
		class MeshTransportDynamicModule {}

		return declareModule(
			{
				module: MeshTransportDynamicModule,
				imports: [DiscoveryModule],
				providers: [
					{ provide: MESH_TRANSPORT_OPTIONS, useValue: options },
					{
						// The tag is the service; `live` is its implementation, built once from the two Nest providers.
						provide: MeshRouterResolver,
						useFactory: (discovery: DiscoveryService) => MeshRouterResolver.live({ discovery, options }),
						inject: [DiscoveryService],
					},
				],
				exports: [MeshRouterResolver, MESH_TRANSPORT_OPTIONS],
			},
			{},
		);
	},
} as const;

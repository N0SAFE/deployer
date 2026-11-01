import { Module, type DynamicModule } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { MeshRouterResolver } from "./mesh-router.resolver";
import { MESH_TRANSPORT_OPTIONS, type MeshTransportOptions } from "./mesh-transport.options";

/**
 * Provides the resolver that turns `@MeshTransport()` metadata into the two mesh routers.
 *
 * `forRoot` takes the contract every door is validated against; the host owns the transport itself (the websocket, the
 * socket, the loops), because those are its own resources.
 */
@Module({})
export class MeshTransportModule {
	static forRoot(options: MeshTransportOptions): DynamicModule {
		return {
			module: MeshTransportModule,
			imports: [DiscoveryModule],
			providers: [MeshRouterResolver, { provide: MESH_TRANSPORT_OPTIONS, useValue: options }],
			exports: [MeshRouterResolver, MESH_TRANSPORT_OPTIONS],
		};
	}
}

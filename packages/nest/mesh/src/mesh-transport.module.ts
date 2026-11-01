import { Module, type DynamicModule } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { MeshRouterResolver, MeshRoutersService } from "./mesh-router.resolver";
import { MESH_TRANSPORT_OPTIONS, type MeshTransportOptions } from "./mesh-transport.options";

/**
 * Provides the resolver and the routers it builds: `MeshController` classes in, `{ peer, node, admin }` out.
 *
 * `forRoot` takes the contract every door is validated against; the host owns the transport itself (the websocket, the
 * sockets, the loops), because those are its own resources. Importing this module is mandatory for an app that declares
 * `MeshController` classes — without it there is no resolver, and therefore no door.
 */
@Module({})
export class MeshTransportModule {
	static forRoot(options: MeshTransportOptions): DynamicModule {
		return {
			module: MeshTransportModule,
			imports: [DiscoveryModule],
			providers: [
				MeshRouterResolver,
				{ provide: MESH_TRANSPORT_OPTIONS, useValue: options },
				{ provide: MeshRoutersService, useFactory: (resolver: MeshRouterResolver) => resolver.resolve(), inject: [MeshRouterResolver] },
			],
			exports: [MeshRouterResolver, MeshRoutersService, MESH_TRANSPORT_OPTIONS],
		};
	}
}

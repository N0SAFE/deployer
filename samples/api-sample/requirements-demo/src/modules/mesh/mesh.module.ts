import { createModuleContext, UnmetOf } from "../../effect";

import { MeshDirectoryController } from "./controllers/mesh-directory.controller";
import { MeshRelayController } from "./controllers/mesh-relay.controller";
import { MeshDirectory } from "./services/directory.service";
import { ReplicaStore } from "./services/replica-store.service";
import { MeshRelay } from "./services/relay.service";

/**
 * The mesh domain: the directory, the relay and the store they run on.
 *
 * The module provides what the domain owns. `MeshClock` and `LeaseSigner` come from `PlatformModule`, which is global:
 * visible without an import, as in Nest. A parent still cannot resolve anything for this module — only its own providers,
 * its imports' exports and the globals can.
 */
export const MeshDomainModule = createModuleContext({
	controllers: [MeshDirectoryController, MeshRelayController],
	providers: [
		{ provide: ReplicaStore, useValue: ReplicaStore.live },
		{ provide: MeshDirectory, useValue: MeshDirectory.live },
		{ provide: MeshRelay, useValue: MeshRelay.live },
	],
	// An exported service drags its collaborators with it: a consumer that yields `MeshDirectory` runs its methods,
	// and those need `ReplicaStore`. Export only the service and the consumer's requirement set would list it.
	exports: [MeshDirectory, ReplicaStore],
});

/** Resolved by the composition root: `MeshClock` and `LeaseSigner` come from `PlatformModule`. */
export type MeshRequirements = UnmetOf<typeof MeshDomainModule>;

import { createModuleContext } from "../src/effect";
import { DirectoryReaderController } from "../src/modules/consumer/controllers/directory-reader.controller";
import { MeshDirectory } from "../src/modules/mesh/services/directory.service";

/**
 * VIOLATION, reported at BOTH ends of the same gap:
 * - here, on `DirectoryReaderController`: it reaches `MeshDirectory` (provided below), which runs on `ReplicaStore` — and
 *   this module provides no `ReplicaStore`;
 * - in `src/modules/mesh/services/directory.service.ts`, on each use of `ReplicaStore`: the provider whose code needs it.
 */
export const DirectoryWithoutStoreModule = createModuleContext({
	controllers: [DirectoryReaderController],
	providers: [{ provide: MeshDirectory, useValue: MeshDirectory.live }],
});

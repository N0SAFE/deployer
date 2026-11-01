import { createModuleContext } from "../../effect";
import { MeshDomainModule } from "../mesh/mesh.module";

import { DirectoryReaderController } from "./controllers/directory-reader.controller";

/**
 * A consumer domain: it provides nothing, it imports the mesh.
 *
 * What it can reach is exactly what the mesh exports. `MeshDirectory` and `ReplicaStore` are exported, so they arrive;
 * `MeshRelay` is a mesh provider that is not exported, so it never does — the same rule Nest applies, checked at compile
 * time and enforced by the scoped runtime context.
 */
export const ConsumerModule = createModuleContext({
	imports: [MeshDomainModule],
	controllers: [DirectoryReaderController],
});

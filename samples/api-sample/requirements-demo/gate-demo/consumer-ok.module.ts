import { createModuleContext } from "../src/effect";
import { DirectoryReaderController } from "../src/modules/consumer/controllers/directory-reader.controller";
import { MeshDomainModule } from "../src/modules/mesh/mesh.module";

/** CLEAN: the controller yields `MeshDirectory`, and the module imports the module that exports it. No finding. */
export const ConsumerOkModule = createModuleContext({
	imports: [MeshDomainModule],
	controllers: [DirectoryReaderController],
});

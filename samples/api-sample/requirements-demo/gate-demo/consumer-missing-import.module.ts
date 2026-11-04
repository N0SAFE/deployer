import { createModuleContext } from "../src/effect";
import { DirectoryReaderController } from "../src/modules/consumer/controllers/directory-reader.controller";

/**
 * VIOLATION `deployer-effect/requirementFlow`: `DirectoryReaderController` yields `MeshDirectory`, but this module neither
 * provides it nor imports `MeshDomainModule`. The type flow records the gap in `UnmetRequirementsOf`; the gate reports it
 * at the controller entry instead of three files away at the composition root as `Missing<...>`.
 */
export const ConsumerMissingImportModule = createModuleContext({
	controllers: [DirectoryReaderController],
});

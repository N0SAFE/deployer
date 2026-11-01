import { createModuleContext } from "../effect-graph";
import { HealthRegistryModule } from "./health-registry.module";
import { HealthLive } from "./health.service";

/**
 * The domain module chains itself to the registry.
 *
 * `HealthLive` contributes `HealthService` to the context and `HealthRegistry`
 * to the requirements. The import supplies the requirement, so the module
 * closes: `{ HealthRegistry } - { HealthRegistry, HealthService } = never`.
 *
 * Remove the import and the call stops compiling, naming `HealthRegistry`.
 * There is no app-level layer list to update and nothing to check at boot.
 */
export class HealthDomainModule extends createModuleContext(
	{ name: "HealthDomainModule", imports: [HealthRegistryModule] },
	HealthLive,
) {}

import { ConfigurationCoreModule } from "@deployer/shared/core/modules/configuration/configuration-core.module";
import { CoreDomainModule } from "@deployer/shared/core/modules/domain/domain.module";
import { DomainConflictService } from "@deployer/shared/core/modules/domain/services/domain-conflict.service";
import { DomainVerificationService } from "@deployer/shared/core/modules/domain/services/domain-verification.service";
import { ProjectDomainRepository } from "@deployer/shared/core/modules/domain/repositories/project-domain.repository";
import { ServiceDomainMappingRepository } from "@deployer/shared/core/modules/domain/repositories/service-domain-mapping.repository";
import { ProjectAccessService } from "@deployer/shared/core/modules/project/services/project-access.service";
import { ProjectCoreModule } from "@deployer/shared/core/modules/project/project-core.module";
import { CoreReachabilityModule } from "@deployer/shared/core/modules/reachability/core-reachability.module";
import { DomainConflict } from "@project/core/ports/domain-conflict.port";
import { DomainVerification } from "@project/core/ports/domain-verification.port";
import { ProjectAccess } from "@project/core/ports/project-access.port";
import { ProjectDomainRepo } from "@project/core/ports/project-domain-repository.port";
import { ServiceDomainMappingRepo } from "@project/core/ports/service-domain-mapping-repository.port";
import { createModuleContext } from "@deployer/nest-effect";

import { ProjectDomainController } from "./controllers/project-domain.controller";
import { ServiceDomainController } from "./controllers/service-domain.controller";
import { DomainProjectService } from "./services/domain-project.service";
import { DomainServiceService } from "./services/domain-service.service";

/**
 * Domain assignment: which domains a project owns, and which of them a service
 * is reachable on.
 *
 * The shared core services stay Nest providers; each one is exposed to the Effect layer through a
 * port so the services can `yield*` them. The use cases are Layers (`DomainLive`, see
 * `domain.layers.ts`) built by the app's Effect runtime.
 */
export class DomainModule extends createModuleContext({
	imports: [
		CoreDomainModule,
		ProjectCoreModule,
		ConfigurationCoreModule,
		CoreReachabilityModule,
	],
	controllers: [ProjectDomainController, ServiceDomainController],
	providers: [
		{ provide: ProjectAccess, useExisting: ProjectAccessService },
		{ provide: DomainConflict, useExisting: DomainConflictService },
		{ provide: DomainVerification, useExisting: DomainVerificationService },
		{ provide: ProjectDomainRepo, useExisting: ProjectDomainRepository },
		{
			provide: ServiceDomainMappingRepo,
			useExisting: ServiceDomainMappingRepository,
		},
	],
	exports: [],
}, DomainProjectService, DomainServiceService) {}

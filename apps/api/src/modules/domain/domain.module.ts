import { Module } from "@nestjs/common";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";
import { CoreDomainModule } from "@/core/modules/domain/domain.module";
import { ProjectCoreModule } from "@/core/modules/project/project-core.module";
import { CoreReachabilityModule } from "@/core/modules/reachability/core-reachability.module";
import { ProjectDomainController } from "./controllers/project-domain.controller";
import { ServiceDomainController } from "./controllers/service-domain.controller";
import { DomainProjectService } from "./services/domain-project.service";
import { DomainServiceService } from "./services/domain-service.service";

@Module({
    imports: [CoreDomainModule, ProjectCoreModule, ConfigurationCoreModule, CoreReachabilityModule],
    controllers: [ProjectDomainController, ServiceDomainController],
    providers: [DomainProjectService, DomainServiceService],
    exports: [DomainProjectService, DomainServiceService],
})
export class DomainModule {}
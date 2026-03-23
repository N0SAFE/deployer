import { Module } from "@nestjs/common";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";
import { CoreDomainModule } from "@/core/modules/domain/domain.module";
import { ProjectCoreModule } from "@/core/modules/project/project-core.module";
import { OrganizationDomainController } from "./controllers/organization-domain.controller";
import { ProjectDomainController } from "./controllers/project-domain.controller";
import { ServiceDomainController } from "./controllers/service-domain.controller";
import { DomainOrganizationService } from "./services/domain-organization.service";
import { DomainProjectService } from "./services/domain-project.service";
import { DomainServiceService } from "./services/domain-service.service";

@Module({
    imports: [CoreDomainModule, ProjectCoreModule, ConfigurationCoreModule],
    controllers: [OrganizationDomainController, ProjectDomainController, ServiceDomainController],
    providers: [DomainOrganizationService, DomainProjectService, DomainServiceService],
    exports: [DomainOrganizationService, DomainProjectService, DomainServiceService],
})
export class DomainModule {}
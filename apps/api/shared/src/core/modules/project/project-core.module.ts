import { createModuleContext } from "@deployer/nest-effect";
import { DatabaseModule } from "../database/database.module";
import { ProjectAccessService } from "./services/project-access.service";
import { ProjectAccessRepository } from "./repositories/project-access.repository";

export class ProjectCoreModule extends createModuleContext({
    imports: [DatabaseModule],
    providers: [ProjectAccessService, ProjectAccessRepository],
    exports: [ProjectAccessService],
}) {}
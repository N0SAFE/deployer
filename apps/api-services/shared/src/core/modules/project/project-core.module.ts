import { Module } from "@nestjs/common";
import { DatabaseModule } from "@/core/modules/database/database.module";
import { ProjectAccessService } from "@/core/modules/project/services/project-access.service";
import { ProjectAccessRepository } from "@/core/modules/project/repositories/project-access.repository";

@Module({
    imports: [DatabaseModule],
    providers: [ProjectAccessService, ProjectAccessRepository],
    exports: [ProjectAccessService],
})
export class ProjectCoreModule {}
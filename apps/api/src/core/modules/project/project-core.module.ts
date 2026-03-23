import { Module } from "@nestjs/common";
import { DatabaseModule } from "@/core/modules/database/database.module";
import { ProjectAccessService } from "./services/project-access.service";

@Module({
    imports: [DatabaseModule],
    providers: [ProjectAccessService],
    exports: [ProjectAccessService],
})
export class ProjectCoreModule {}
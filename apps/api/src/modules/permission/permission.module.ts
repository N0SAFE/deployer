import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../core/modules/database/database.module";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";
import { PermissionRepository } from "./repositories/permission.repository";
import { PermissionService } from "./services/permission.service";

@Module({
  imports: [DatabaseModule, ConfigurationCoreModule],
  providers: [PermissionService, PermissionRepository],
  exports: [PermissionService, PermissionRepository],
})
export class PermissionModule {}

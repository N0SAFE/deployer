import { Module } from "@nestjs/common";

import { DatabasePortModule } from "@identity/core/database/database.module";

import { RoleCatalogueRefresher } from "./role-catalogue.refresher";
import { RoleSeeder } from "./role.seed";

/**
 * The boot-time role work, in a plain Nest module: seed the table, then load the authorization snapshot from it.
 *
 * `RoleDomainModule` is an Effect module whose provider list contributes `Context.Service` tags; a lifecycle class is
 * not one of those, and adding it there made the requirement gate read the controller's needs as `any`. Seeding needs
 * no request context, so it stays on Nest's own `OnApplicationBootstrap`.
 */
@Module({
	imports: [DatabasePortModule],
	providers: [RoleSeeder, RoleCatalogueRefresher],
})
export class RoleSeedModule {}

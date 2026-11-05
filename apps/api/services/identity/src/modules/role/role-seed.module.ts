import { Module } from "@nestjs/common";

import { declareModule } from "@deployer/nest-effect";
import { RoleCatalogueModule } from "@deployer/shared/core/authz/role-catalogue.module";

import { DatabasePortModule } from "@identity/core/database/database.module";

import { RoleSeeder } from "./role.seed";

/**
 * The boot-time role work, in a plain Nest module: seed the table, then load the authorization snapshot from it.
 *
 * `RoleDomainModule` is an Effect module whose provider list contributes `Context.Service` tags; a lifecycle class is
 * not one of those, and adding it there made the requirement gate read the controller's needs as `any`. Seeding needs
 * no request context, so it stays on Nest's own `OnApplicationBootstrap`.
 */
@Module({
	imports: [DatabasePortModule, RoleCatalogueModule],
	providers: [RoleSeeder],
})
class RoleSeed {}

/**
 * Declared, not bare: the module owns no Effect service (seeding is a boot task), and `declareModule` is what says so in
 * the type flow. Without it an importer sees `never` rather than "this contributes nothing".
 */
export const RoleSeedModule = declareModule(RoleSeed, { exports: [] });

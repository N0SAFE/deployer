import { Module } from "@nestjs/common";

import { DatabasePortModule } from "@identity/core/database/database.module";

import { RoleSeeder } from "./role.seed";

/**
 * The boot-time role seed, in a plain Nest module.
 *
 * `RoleDomainModule` is an Effect module whose provider list contributes `Context.Service` tags; a lifecycle class is
 * not one of those, and adding it there made the requirement gate read the controller's needs as `any`. Seeding needs
 * no request context, so it stays on Nest's own `OnApplicationBootstrap`.
 */
@Module({
	imports: [DatabasePortModule],
	providers: [RoleSeeder],
})
export class RoleSeedModule {}

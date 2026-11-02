import { createModuleContext } from "@deployer/nest-effect";

import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";

import { TestController } from "./controllers/test.controller";

/**
 * TestModule demonstrates auth middleware usage in ORPC procedures
 * 
 * ## Pattern: ORPC Middleware-based Authorization
 * 
 * Authorization is handled through ORPC middleware chains.
 * 
 * ## Example Usage in Controller:
 * 
 * ```typescript
 * // Use middleware in ORPC procedures
 * baseProcedure
 *     .use(this.authService.middleware.admin.hasPermission({ user: ['create'] }))
 *     .handler(async (input, ctx) => { ... })
 * ```
 */
export class TestDomainModule extends createModuleContext({
	imports: [ConfigurationCoreModule],
	controllers: [TestController],
}) {}
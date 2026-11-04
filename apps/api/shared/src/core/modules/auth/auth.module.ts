import { Module } from "@nestjs/common";

import {
	type ASYNC_OPTIONS_TYPE,
	ConfigurableModuleClass,
	type OPTIONS_TYPE,
} from "./definitions/auth-module-definition";
import { makeSessionResolver, SessionResolver } from "./orpc/session-resolver";
import { AuthCoreService } from "./services/auth-core.service";

import type { DynamicModule } from "@nestjs/common";

/**
 * Provides the Better Auth instance and the oRPC session services.
 *
 * There is NO authorization here: no guard, no decorator, no request hook — and no HTTP either. Better Auth's own routes
 * (sign-in/out, passkey, 2FA, API keys) are mounted by the HTTP edge (`betterAuthEdge`, `server/http-edge.ts`), which reads
 * the options this module was configured with. Every authorization decision on OUR endpoints is a declaration on the oRPC
 * procedure (`requireAuth()`, `access({ permission, scope })`), so a Nest guard would be a second gate that can disagree
 * with the first.
 */
@Module({
	providers: [
		AuthCoreService,
		// Better Auth answers `getSession`; the oRPC auth plugin asks through this Effect service.
		{ provide: SessionResolver, useFactory: (core: AuthCoreService) => makeSessionResolver(core.instance), inject: [AuthCoreService] },
	],
	exports: [AuthCoreService, SessionResolver],
})
export class AuthModule extends ConfigurableModuleClass {
	static forRootAsync(options: typeof ASYNC_OPTIONS_TYPE): DynamicModule {
		return { ...super.forRootAsync(options) };
	}

	static forRoot(options: typeof OPTIONS_TYPE): DynamicModule {
		return { ...super.forRoot(options) };
	}
}

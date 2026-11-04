import { Inject, Logger, Module } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { toNodeHandler } from "better-auth/node";

import { AppError } from "@deployer/errors";

import {
	type ASYNC_OPTIONS_TYPE,
	type AuthModuleOptions,
	ConfigurableModuleClass,
	MODULE_OPTIONS_TOKEN,
	type OPTIONS_TYPE,
} from "./definitions/auth-module-definition";
import { SkipBodyParsingMiddleware } from "./middlewares/middlewares";
import { makeSessionResolver, SessionResolver } from "./orpc/session-resolver";
import { AuthCoreService } from "./services/auth-core.service";

import type { DynamicModule, MiddlewareConsumer, NestModule } from "@nestjs/common";

/**
 * Mounts the Better Auth instance and provides the oRPC session services.
 *
 * There is NO authorization here: no guard, no decorator, no request hook. Better Auth answers its own endpoints
 * (sign-in/out, passkey, 2FA, API keys) at `basePath`; every authorization decision on OUR endpoints is a declaration on
 * the oRPC procedure (`requireAuth()`, `.access({ permission, scope })`), so a Nest guard would be a second gate that can
 * disagree with the first.
 */
@Module({
	providers: [
		AuthCoreService,
		// Better Auth answers `getSession`; the oRPC auth plugin asks through this Effect service.
		{ provide: SessionResolver, useFactory: (core: AuthCoreService) => makeSessionResolver(core.instance), inject: [AuthCoreService] },
	],
	exports: [AuthCoreService, SessionResolver],
})
export class AuthModule extends ConfigurableModuleClass implements NestModule {
	private readonly logger = new Logger(AuthModule.name);

	constructor(
		@Inject(HttpAdapterHost)
		private readonly adapter: HttpAdapterHost,
		@Inject(MODULE_OPTIONS_TOKEN)
		private readonly options: AuthModuleOptions,
	) {
		super();
	}

	configure(consumer: MiddlewareConsumer): void {
		// Get basePath from options or use default
		let basePath =
			"basePath" in this.options.auth.options && typeof this.options.auth.options.basePath === "string"
				? this.options.auth.options.basePath
				: "/api/auth";

		// Ensure basePath starts with /
		if (!basePath.startsWith("/")) {
			basePath = `/${basePath}`;
		}

		// Ensure basePath doesn't end with /
		if (basePath.endsWith("/")) {
			basePath = basePath.slice(0, -1);
		}

		// ── Register BetterAuth handler as NestJS middleware ────────────────
		// This runs BEFORE the NestJS router (middleware resolution happens before
		// router registration in NestJS init), so BetterAuth intercepts auth
		// requests before the 404 handler.
		consumer.apply(toNodeHandler(this.options.auth)).forRoutes(basePath);
		this.logger.log(`BetterAuth handler registered at "${basePath}"`);

		const trustedOrigins =
			"trustedOrigins" in this.options.auth.options ? this.options.auth.options.trustedOrigins : null;
		// function-based trustedOrigins requires a Request (from web-apis) object to evaluate, which is not available in
		// NestJS (we only have a express Request object). If we ever need this, better-call has an implementation.
		const isNotFunctionBased = trustedOrigins && Array.isArray(trustedOrigins);

		if (!this.options.disableTrustedOriginsCors && isNotFunctionBased) {
			this.adapter.httpAdapter.enableCors({
				origin: trustedOrigins,
				methods: ["GET", "POST", "PUT", "DELETE"],
				credentials: true,
				allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
				exposedHeaders: ["Set-Cookie"],
			});
		} else if (trustedOrigins && !this.options.disableTrustedOriginsCors && !isNotFunctionBased)
			throw new AppError(
				"Function-based trustedOrigins not supported in NestJS. Use string array or disable CORS with disableTrustedOriginsCors: true.",
				"AUTH_CONFIG_ERROR",
			);

		// Only apply body parsing middleware if NestJS global body parser is disabled.
		if (!this.options.disableBodyParser) {
			consumer.apply(SkipBodyParsingMiddleware(basePath)).forRoutes("*path");
		}
	}

	static forRootAsync(options: typeof ASYNC_OPTIONS_TYPE): DynamicModule {
		return { ...super.forRootAsync(options) };
	}

	static forRoot(options: typeof OPTIONS_TYPE): DynamicModule {
		return { ...super.forRoot(options) };
	}
}

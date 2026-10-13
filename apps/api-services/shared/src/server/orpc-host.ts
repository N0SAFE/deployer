import { Logger } from "@nestjs/common";
import { REQUEST } from "@nestjs/core";
import { ORPCModule } from "@orpc/nest";
import type { Router } from "@orpc/server";
import { AuthPlugin } from "@/core/modules/auth/orpc/plugins/auth.plugin";
import type { ORPCGlobalContext } from "@/core/modules/auth/orpc/orpc-context";
import {
	logOrpcErrors,
	transformNestJSErrorToOrpcError,
} from "@/core/modules/auth/orpc/index";
import { AuthCoreService } from "@/core/modules/auth/services/auth-core.service";
import { InternalErrorInsightService } from "@/core/middlewares/internal-error/internal-error-insight.service";
import {
	RequestCompressionHandlerPlugin,
	ResponseCompressionHandlerPlugin,
} from "@orpc/server/plugins";
import { SmartCoercionHandlerPlugin } from "@orpc/json-schema";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import type { DynamicModule } from "@nestjs/common";

/**
 * The ONE oRPC configuration shared by the BFF and every service.
 *
 * ── WHAT AN IMPORTING APP MUST PROVIDE ──────────────────────────────────────
 * `AuthCoreService`. The factory below INJECTS it, so it must exist in the
 * importing app's graph — which means the app imports an auth module that provides
 * it. That requirement cannot be satisfied from inside this function: a NestJS
 * module may only export providers it owns, and `ORPCModule` does not own
 * `AuthCoreService`, so adding it to `exports` here throws
 * `UnknownExportException` at boot rather than helping.
 *
 * It is stated here, in the doc, because the failure is otherwise opaque — the
 * message names a Symbol (`ORPC_NEST_MODULE_CONFIG`) and an index, and says nothing
 * about which module was supposed to supply the service.
 *
 * ── WHY THE AUTH PLUGIN LIVES HERE, IN EVERY APP ────────────────────────────
 * The BFF is the only process that RECEIVES a browser session, but it is not the
 * only process that needs to know who the caller is: a service's handler reads
 * `context.auth`, and services are separate processes. The plugin resolves the
 * session from the request, and a service receives the BFF's forwarded request — so
 * binding the same plugin everywhere means `context.auth` means the same thing on
 * both sides of the boundary, with no special case in a handler.
 *
 * ── WHY `interceptors` AND NOT `sendResponseInterceptors` ───────────────────
 * oRPC v2 renamed it. The old key is silently ignored (it is not on the config type,
 * and excess-property checking does not fire on this literal), which degrades every
 * domain error to a generic 500 with no warning — the rename is load-bearing, not
 * cosmetic.
 */
export function createOrpcModule(): DynamicModule {
	return ORPCModule.forRootAsync({
		useFactory: (request: Request, authCoreService: AuthCoreService) => {
			const emptyAuthUtils = authCoreService.createEmptyAuthUtils();
			const internalErrorInsightService = new InternalErrorInsightService();

			return {
				interceptors: [
					transformNestJSErrorToOrpcError(),
					logOrpcErrors(new Logger("ORPC Errors"), internalErrorInsightService),
				],
				plugins: [
					// Request compression is symmetric with the web app's
					// RequestCompressionLinkPlugin; both default to a 1 KB threshold so
					// small payloads are never inflated. Response compression negotiates
					// from the client's Accept-Encoding.
					new RequestCompressionHandlerPlugin(),
					new ResponseCompressionHandlerPlugin({ encodings: ["gzip"] }),
					// v2 renamed the plugin and its option: the schema-agnostic Smart
					// Coercion plugin now takes `converters`.
					new SmartCoercionHandlerPlugin<ORPCGlobalContext>({
						converters: [new ZodToJsonSchemaConverter()],
					}),
					// Populates context.auth from the request's session.
					new AuthPlugin<ORPCGlobalContext>({ auth: authCoreService.instance }),
				],
				// Initial context - auth will be populated by AuthPlugin
				context: { request, auth: emptyAuthUtils },
			};
		},
		inject: [REQUEST, AuthCoreService],
	});
}

/** The router type every app's composed contract satisfies. */
export type ApiRouter = Router<ORPCGlobalContext>;

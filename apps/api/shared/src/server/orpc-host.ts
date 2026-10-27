import { Logger } from "@nestjs/common";
import { REQUEST } from "@nestjs/core";
import { ORPCModule } from "@orpc/nest";
import type { DefaultInitialContext, Router } from "@orpc/server";
import { AuthPlugin } from "../core/modules/auth/orpc/plugins/auth.plugin";
import type { ORPCGlobalContext } from "../core/modules/auth/orpc/orpc-context";
import {
	logOrpcErrors,
	transformNestJSErrorToOrpcError,
} from "../core/modules/auth/orpc/index";
import { AuthCoreService } from "../core/modules/auth/services/auth-core.service";
import { InternalErrorInsightService } from "../core/middlewares/internal-error/internal-error-insight.service";
import {
	RequestCompressionHandlerPlugin,
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
/** DI tokens an app may contribute to the per-request oRPC context. */
type ExtraTokens = readonly (abstract new (...args: any[]) => any)[];

/** The injected instances, in the same order as `inject`. */
type ExtraInstances<D extends ExtraTokens> = {
	[K in keyof D]: InstanceType<D[K]>;
};

type ExtraContext<D extends ExtraTokens> = {
	readonly inject: D;
	readonly resolve: (
		...deps: ExtraInstances<D>
	) => Promise<Record<string, unknown>> | Record<string, unknown>;
};

export type CreateOrpcModuleOptions<ExtraD extends ExtraTokens = []> = {
	/**
	 * Extra initial-context fields resolved from DI per request.
	 *
	 * Used by an app that needs runtime-backed context (for example
	 * `'effect/context'`). `inject` feeds `resolve`; both are opt-in, so the
	 * default transport policy stays identical for every other service.
	 *
	 * `inject` is a tuple, so `resolve` receives the injected instances as typed
	 * parameters — no cast at the call site.
	 */
	extraContext?: ExtraContext<ExtraD>;
}

export function createOrpcModule<ExtraD extends ExtraTokens = []>(
	options: CreateOrpcModuleOptions<ExtraD> = {},
): DynamicModule {
	const extra = options.extraContext;

	return ORPCModule.forRootAsync({
		useFactory: async (
			request: Request,
			authCoreService: AuthCoreService,
			...deps: ExtraInstances<ExtraD>
		) => {
			const emptyAuthUtils = authCoreService.createEmptyAuthUtils();
			const internalErrorInsightService = new InternalErrorInsightService();

			/**
			 * The app owns the extra keys (e.g. `effect/context`); shared cannot
			 * type them, so the assembled object is asserted once here. Apps that
			 * augment `DefaultInitialContext` provide the matching `extraContext`.
			 */
			const context = {
				request,
				auth: emptyAuthUtils,
				...(extra ? await extra.resolve(...deps) : {}),
			} as unknown as DefaultInitialContext;

			return {
				interceptors: [
					transformNestJSErrorToOrpcError(),
					logOrpcErrors(new Logger("ORPC Errors"), internalErrorInsightService),
				],
				plugins: [
					// Request compression is symmetric with the web app's
					// RequestCompressionLinkPlugin; both default to a 1 KB threshold so
					// small payloads are never inflated.
					new RequestCompressionHandlerPlugin(),
					// ── NO RESPONSE COMPRESSION. IT BREAKS THE SERVICE-TO-SERVICE LEG ──
					//
					// `ResponseCompressionHandlerPlugin({ encodings: ["gzip"] })` was here,
					// and it made every analytics endpoint whose payload exceeded 1 KB
					// fail through the BFF:
					//
					//   GET /analytics/metrics/realtime    → 200 (290 B, no compression)
					//   GET /analytics/metrics/database    → 200 (76 B,  no compression)
					//   GET /analytics/metrics/resources   → 500 "Output validation failed"
					//   GET /analytics/metrics/deployments → 500 "Output validation failed"
					//
					// Measured, not inferred — the same response with and without gzip:
					//
					//   default           getResourceMetrics  STREAM
					//   accept-encoding: identity            OBJECT keys=[data,timeRange,…]
					//
					//   resources    status=200 content-length=null transfer-encoding=chunked content-encoding=gzip
					//   realtime     status=200 content-length=290  transfer-encoding=null    content-encoding=null
					//
					// The mechanism is `content-length`, not encoding: oRPC returns a
					// `ReadableStream` for any response it cannot size eagerly, and the
					// client hands that stream straight to the output schema. So
					//
					//   ✖ Invalid input: expected array, received undefined   → at data
					//   ✖ Invalid input: expected string, received undefined  → at timeRange
					//   ✖ Invalid input: expected string, received undefined  → at granularity
					//
					// — the schema validating a stream. `ResponseCompressionLinkPlugin` on
					// the client does NOT help (measured: still STREAM), because the body is
					// still chunked after decompression.
					//
					// The browser leg is unaffected either way (fetch decompresses and the
					// web app never sees the stream), and these payloads are single-digit
					// kilobytes over a local bridge — compression buys nothing worth a
					// contract that fails validation on size.
					new SmartCoercionHandlerPlugin<ORPCGlobalContext>({
						converters: [new ZodToJsonSchemaConverter()],
					}),
					// Populates context.auth from the request's session.
					new AuthPlugin<ORPCGlobalContext>({ auth: authCoreService.instance }),
				],
				// Initial context - auth will be populated by AuthPlugin.
				// `extraContext` is resolved per request (e.g. the Effect runtime).
				context,
			};
		},
		inject: [REQUEST, AuthCoreService, ...(extra?.inject ?? [])],
	});
}

/** The router type every app's composed contract satisfies. */
export type ApiRouter = Router<ORPCGlobalContext>;

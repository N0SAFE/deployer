/**
 * AppInstancePlugin — attaches the web app's own identity token to
 * SERVER-SIDE ORPC calls. The token never reaches the browser bundle:
 * client-side requests are passed through untouched (cookies carry the user
 * session; the app-instance token is a server-to-server credential).
 *
 * Why a registry instead of importing the identity module (even dynamically):
 * Turbopack includes dynamically-imported modules in CLIENT chunks too, and
 * the identity module imports "server-only" — which throws whenever its file
 * lands anywhere in the client graph (this broke /setup in dev). So this
 * plugin only knows about an abstract provider function; the actual import
 * happens in src/instrumentation.ts, which exists solely in the server
 * bundle and registers the real provider at server startup.
 */
import { StandardLinkOptions, StandardLinkPlugin } from "@orpc/client/standard";
import type { ClientContext } from "@orpc/client";

export type AppInstanceTokenProvider = () => Promise<string>;

const globalRegistry = globalThis as typeof globalThis & {
	__deployerAppInstanceTokenProvider?: AppInstanceTokenProvider;
};

/**
 * Register the server-side token provider. Called once from
 * src/instrumentation.ts (server startup). Idempotent.
 */
export function registerAppInstanceTokenProvider(
	provider: AppInstanceTokenProvider,
): void {
	globalRegistry.__deployerAppInstanceTokenProvider = provider;
}

export class AppInstancePlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
	init(link: StandardLinkOptions<T>): void {
		link.clientInterceptors ??= [];

		link.clientInterceptors.push(async (options) => {
			if (typeof window !== "undefined") {
				return options.next(options);
			}
			const provider = globalRegistry.__deployerAppInstanceTokenProvider;
			if (!provider) {
				// Server started without instrumentation registration (should not
				// happen) — pass through rather than break the call.
				return options.next(options);
			}
			try {
				const token = await provider();
				options.request.headers["x-app-instance-token"] = token;
			} catch {
				// Identity bootstrap failure must not break public/health calls —
				// protected surfaces will surface the missing header as 401.
			}
			return options.next(options);
		});
	}
}

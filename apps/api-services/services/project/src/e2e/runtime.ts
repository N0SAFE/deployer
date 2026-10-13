import {
	getSharedApiRuntimeContext as getShared,
	useDescribeSharedApiRuntime as useDescribeShared,
	type SharedApiRuntimeContext,
	type SharedApiRuntimeOptions,
	type DescribeSharedRuntimeScope,
	type SharedRuntimeOrpcClientOptions,
} from "@/e2e-harness/shared-api-runtime";
import { createSharedSetupOrpcClient as createSharedSetupOrpcClientRaw } from "@/e2e-harness/shared-api-runtime";

/**
 * The shared e2e harness, bound to THIS service's root module.
 *
 * ── WHY THIS WRAPPER EXISTS ─────────────────────────────────────────────────
 * The harness is app-agnostic: it lives in `shared` and boots whatever module it is given.
 * `@/app.module` only resolves inside an app, so it cannot default, and repeating the
 * loader in every spec would be a copy per file that silently boots the wrong service the
 * day one drifts. Binding it once here means a spec gets the right graph, and exactly one
 * place names which app these e2e tests exercise.
 */
const rootModuleLoader = async () => (await import("@/app.module")).ProjectServiceModule;

function withRootModule(options: SharedApiRuntimeOptions = {}): SharedApiRuntimeOptions {
	return {
		...options,
		nest: { ...options.nest, rootModuleLoader },
	};
}

export async function getSharedApiRuntimeContext(
	options?: SharedApiRuntimeOptions,
): Promise<SharedApiRuntimeContext> {
	return getShared(withRootModule(options));
}

export function useDescribeSharedApiRuntime(
	options: SharedApiRuntimeOptions = {},
): DescribeSharedRuntimeScope {
	return useDescribeShared(withRootModule(options));
}

export type { SharedApiRuntimeContext, SharedApiRuntimeOptions, DescribeSharedRuntimeScope };
export { setSharedRuntimeAuthHeaders, setSharedRuntimeRequestOverride, resetSharedRuntimeRequestOverride } from "@/e2e-harness/shared-api-runtime";

/**
 * The setup-surface client, bound to this app's root module.
 *
 * Bound here rather than called directly because it takes the same runtime options the
 * context does — an unbound call would boot a runtime with no root module and now fail.
 */
export async function createSharedSetupOrpcClient(
	options?: SharedRuntimeOrpcClientOptions,
	runtimeOptions?: SharedApiRuntimeOptions,
) {
	return createSharedSetupOrpcClientRaw(options, withRootModule(runtimeOptions));
}

export { stopSharedApiRuntime } from "@/e2e-harness/shared-api-runtime";

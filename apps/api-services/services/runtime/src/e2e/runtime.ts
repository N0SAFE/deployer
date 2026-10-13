import {
	getSharedApiRuntimeContext as getShared,
	useDescribeSharedApiRuntime as useDescribeShared,
	type SharedApiRuntimeContext,
	type SharedApiRuntimeOptions,
	type DescribeSharedRuntimeScope,
	type SharedRuntimeOrpcClientOptions,
} from "@/e2e-harness/shared-api-runtime";
import { createSharedSetupOrpcClient as createSharedSetupOrpcClientRaw } from "@/e2e-harness/shared-api-runtime";
import { DeploymentQueueWorkerService } from "@/modules/deployment/queue/deployment-queue.worker.service";

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
const rootModuleLoader = async () => (await import("@/app.module")).RuntimeServiceModule;

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
 * Boot the app with `DeploymentQueueWorkerService` made inert.
 *
 * ── WHY A SUITE WOULD WANT THIS ─────────────────────────────────────────────
 * The worker subscribes to `onJobQueued()` and CLAIMS + EXECUTES any job carrying
 * a `deploymentId`, on the same tick it is enqueued. A suite that asserts the
 * enqueued job's shape and then drives its lifecycle itself (claim → heartbeat →
 * complete) is racing the worker for the job: whichever claims first wins, and the
 * loser sees a job that is already `claimed`.
 *
 * That race is why `triggers an upload deployment and drives its queue job to
 * completion` failed with `Expected a queued deploy job` while the job was present
 * as `claimed`. The suite is asserting the CONTRACT between the domain and its
 * worker — the payload the worker will consume — so it must own the queue, and the
 * worker must not run.
 *
 * ── WHY THIS IS A NO-OP AND NOT A DELETION ──────────────────────────────────
 * The worker is a real provider in the real graph; removing it would make the
 * suite boot a graph that ships nowhere. Overriding it with an inert double keeps
 * the graph intact and states exactly what is being taken out of the picture.
 */
export function withDeploymentQueueWorkerDisabled(
	options: SharedApiRuntimeOptions = {},
): SharedApiRuntimeOptions {
	return {
		...options,
		nest: {
			...options.nest,
			onModuleBuilder: async (context) => {
				context.moduleBuilder
					.overrideProvider(DeploymentQueueWorkerService)
					.useValue({
						onModuleInit: () => undefined,
						onModuleDestroy: () => undefined,
						processQueueJob: async () => undefined,
					});
				await options.nest?.onModuleBuilder?.(context);
			},
		},
	};
}

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

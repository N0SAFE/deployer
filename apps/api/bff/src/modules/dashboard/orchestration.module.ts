import { createModuleContext } from "@deployer/nest-effect";

import { IdentityClient } from "@/clients/identity/identity.client";
import { ProjectClient } from "@/clients/project/project.client";
import { RuntimeClient } from "@/clients/runtime/runtime.client";
import { ServiceClientRegistry } from "@/clients/service-registry";

import { OverviewComposerService } from "../shared/services/overview-composer.service";
import { ScreenReadService } from "../shared/services/screen-read.service";

import { OrchestrationController } from "./controllers/orchestration.controller";
import { AnalyticsReadService } from "./services/analytics-read.service";

/**
 * The BFF's composition surface.
 *
 * ── WHY BOTH READERS ARE DECLARED HERE ──────────────────────────────────────
 * `ScreenReadService` and `OverviewComposerService` are consumed ONLY by this
 * controller. Declaring them at `BffModule` level would make them visible to every
 * module the BFF imports — scope they do not need — and would hide the fact that this
 * module is the only thing depending on the service topology.
 *
 * `ServiceClientRegistry` is NOT declared here: it is `@Global()` (see
 * `ServiceClientModule`), and the reason is documented there.
 */
export class OrchestrationModule extends createModuleContext({
	controllers: [OrchestrationController],
	// Plain classes over the Promise clients (whose credentials come from the request's `service-auth-context`), built by the
	// module: nothing here has a lifetime or a Nest role.
	providers: [
		{
			provide: ScreenReadService,
			useFactory: (identity: IdentityClient, projects: ProjectClient, runtime: RuntimeClient) =>
				new ScreenReadService(identity, projects, runtime),
			inject: [IdentityClient, ProjectClient, RuntimeClient],
		},
		{
			provide: OverviewComposerService,
			useFactory: (reads: ScreenReadService) => new OverviewComposerService(reads),
			inject: [ScreenReadService],
		},
		{
			provide: AnalyticsReadService,
			useFactory: (registry: ServiceClientRegistry) => new AnalyticsReadService(registry),
			inject: [ServiceClientRegistry],
		},
	],
	exports: [OverviewComposerService],
}) {}

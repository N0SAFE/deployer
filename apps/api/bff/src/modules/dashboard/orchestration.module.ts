import { Module } from "@nestjs/common";

import { OverviewComposerService } from "../shared/services/overview-composer.service";
import { ScreenReadService } from "../shared/services/screen-read.service";
import { AnalyticsReadService } from "./services/analytics-read.service";
import { OrchestrationController } from "./controllers/orchestration.controller";

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
@Module({
	controllers: [OrchestrationController],
	providers: [ScreenReadService, OverviewComposerService, AnalyticsReadService],
	exports: [OverviewComposerService],
})
export class OrchestrationModule {}

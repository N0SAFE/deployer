import { Layer } from "effect";

import { AnalyticsRepository } from "./repositories/analytics.repository";
import { AnalyticsService } from "./services/analytics.service";

/** The analytics feature, assembled: the service over its repository, both visible to the runtime. */
export const AnalyticsLive = AnalyticsService.Live.pipe(Layer.provideMerge(AnalyticsRepository.Live));

import { Module } from "@nestjs/common";

import { PlatformHealthController } from "./controllers/platform-health.controller";
import { PlatformHealthService } from "./services/platform-health.service";

/**
 * The platform health roll-up.
 *
 * `PlatformHealthService` is EXPORTED: other modules report on the platform
 * (the landing page shows its state), and re-implementing the fan-out there would be
 * a second answer to "is the platform fine?".
 */
@Module({
	controllers: [PlatformHealthController],
	providers: [PlatformHealthService],
	exports: [PlatformHealthService],
})
export class PlatformHealthModule {}

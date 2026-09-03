/**
 * PlatformModule — product-facing platform surface (api-centric deployment).
 *
 * Re-exports the core supervisors (already global via SupervisorsModule) and
 * provides the ORPC controllers + HTML management console.
 */

import { Module } from "@nestjs/common";
import { CorePlatformIngressModule } from "@/core/modules/platform-ingress/platform-ingress.module";
import { TraefikCoreModule } from "@/core/modules/traefik/traefik.module";
import { ProvidersModule } from "@/modules/providers/providers.module";
import { PlatformController } from "./controllers/platform.controller";
import { PlatformConsoleController } from "./controllers/platform-console.controller";
import { PlatformManagedWebController } from "./controllers/platform-managed-web.controller";
import { PlatformManagedWebService } from "./services/platform-managed-web.service";

@Module({
	imports: [CorePlatformIngressModule, TraefikCoreModule, ProvidersModule],
	controllers: [
		PlatformController,
		PlatformConsoleController,
		PlatformManagedWebController,
	],
	providers: [PlatformManagedWebService],
})
export class PlatformModule {}

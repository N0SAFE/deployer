import { Module } from "@nestjs/common";

import { CorePlatformIngressModule } from "@/core/modules/platform-ingress/platform-ingress.module";
import { EnvModule } from "@/config/env/env.module";
import { ManagedWebClient } from "./clients/managed-web.client";
import { ConsoleControlController } from "./controllers/console-control.controller";
import { PlatformConsoleController } from "./controllers/platform-console.controller";
import { SetupDoneController } from "./controllers/setup-done.controller";

/**
 * The management console: the API-rendered pages, and the procedures they drive.
 *
 * ── WHY `EnvModule` AND `CorePlatformIngressModule` ARE IMPORTED EXPLICITLY ─
 * `PlatformConsoleController` injects `EnvService` to build the console URL, and
 * `SetupDoneController` injects `HostnameService` to build the dashboard URL. A
 * provider is visible only to the module that declares it, so relying on another
 * module registering these globally left this module unassemblable on its own — the
 * boot failed with
 *
 *   Nest can't resolve dependencies of the PlatformConsoleController (?)
 *   … EnvService at index [0]
 *
 * Importing them here is what makes the module self-contained.
 */
@Module({
	imports: [EnvModule, CorePlatformIngressModule],
	controllers: [PlatformConsoleController, SetupDoneController, ConsoleControlController],
	providers: [ManagedWebClient],
})
export class PlatformConsoleModule {}

/**
 * OrchestrationModule — Root orchestration module for the sub-app pipeline.
 *
 * This is the ONLY module imported by main.ts. It handles:
 *   1. Gateway proxying (via RouterModule → RouterController)
 *   2. Sub-app lifecycle management (via OrchestratorService)
 *   3. Database URL resolution (via SetupDevModule in db-resolver step)
 *   4. Event-driven setup-wizard to main-app transition
 *   5. PLATFORM SUPERVISORS — owned HERE by the GATEWAY app so they run
 *      BEFORE and WHILE the setup wizard (the only way into the platform
 *      now that docker-compose publishes no service ports). The main
 *      sub-app consumes the SAME process-wide registry/events via the
 *      framework `SupervisorsModule` only.
 *
 * Sub-apps import core modules directly — no shared providers are forwarded.
 * The orchestrator only shares RESULTS between sub-apps, not DI providers.
 *
 * Pipeline:
 *   db-resolver (headless) → [setup-wizard if needed] → main-app (last)
 */

import { Module } from "@nestjs/common";
import { RouterModule } from "../router/router.module";
import { LocalDatabaseModule } from "../modules/database/local/local-database.module";
import { DatabaseModule } from "../modules/database/database.module";
import { AppLifecycleModule } from '@repo/nest-lifecycle'
import { NodeConfigRepository } from "../modules/setup/repositories/node-config.repository";
import { OrchestratorService } from "./orchestrator.service";

// Platform supervisors + framework (single owner = the gateway app).
import { EnvModule } from "../../config/env/env.module";
import { CoreDockerModule } from "../modules/docker/docker.module";
import { CorePlatformIngressModule } from "../modules/platform-ingress/platform-ingress.module";
import { SupervisorsModule } from "../modules/supervisors/supervisors.module";
import { SupervisorsDatabaseModule } from "../modules/supervisors/database/database-supervisors.module";
import { SupervisorsPlatformModule } from "../modules/supervisors/platform/platform-supervisors.module";
// Traefik CORE module — owns the instance CONFIG updates (the supervisor only
// ensures the process).
import { TraefikCoreModule } from "../modules/traefik/traefik.module";

@Module({
  imports: [
    RouterModule,
    LocalDatabaseModule,
    DatabaseModule,
    AppLifecycleModule,
    // ── Platform supervisors (boot BEFORE the setup wizard) ──────────────
    EnvModule,
    CoreDockerModule,
    CorePlatformIngressModule,
    SupervisorsModule,
    SupervisorsDatabaseModule,
    SupervisorsPlatformModule,
    TraefikCoreModule,
  ],
  providers: [OrchestratorService, NodeConfigRepository],
})
export class OrchestrationModule {}

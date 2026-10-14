import { Module } from "@nestjs/common";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";
import { GlobalDatabaseModule } from "@/core/modules/database/global/global-database.module";
import { ServiceDagService } from "./services/service-dag.service";
import { FleetRolloutPlannerService } from "./services/fleet-rollout-planner.service";
import { FleetReadinessGateService } from "./services/fleet-readiness-gate.service";
import { FleetRollbackService } from "./services/fleet-rollback.service";
import { FleetFailureContainmentService } from "./services/fleet-failure-containment.service";
import { CrossProjectGateService } from "./services/cross-project-gate.service";
import { DriftReconciliationService } from "./services/drift-reconciliation.service";
import { FleetService } from "./services/fleet.service";
import { FleetRepository } from "./repositories/fleet.repository";
import { FleetController } from "./controllers/fleet.controller";

const FLEET_SERVICES = [
    ServiceDagService,
    FleetRolloutPlannerService,
    FleetReadinessGateService,
    FleetRollbackService,
    FleetFailureContainmentService,
    CrossProjectGateService,
    DriftReconciliationService,
];

@Module({
    imports: [ConfigurationCoreModule, GlobalDatabaseModule],
    controllers: [FleetController],
    providers: [...FLEET_SERVICES, FleetService, FleetRepository],
    exports: [...FLEET_SERVICES, FleetService],
})
export class FleetModule {}

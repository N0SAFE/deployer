import { createModuleContext } from "@deployer/nest-effect";
import { SwarmClusterService, SwarmFleetService, SwarmParticipationService } from "@deployer/nest-effect/swarm";
import { ClusterNodeInventoryRepository } from "@deployer/nest-effect/node-state";
import { ClusterNodeRepository } from "@deployer/nest-effect/node-state";
import { EnvModule, EnvService } from "@deployer/shared/config/env/env.module";
import { SwarmCoreModule } from "@deployer/shared/core/modules/swarm/swarm.module";

import { ClusterController } from "./controllers/cluster.controller";
import {
    ClusterEnvPort,
    ClusterEventsPort,
    ClusterNodeRepoPort,
    NodeInventoryPort,
    SwarmClusterPort,
    SwarmFleetPort,
    SwarmParticipationPort,
} from "./cluster.ports";
import { ClusterSwarmEventsService } from "./events/cluster-swarm-events.service";
import { ClusterService } from "./services/cluster.service";

/**
 * `EnvModule` IS IMPORTED EXPLICITLY: the cluster ports alias `EnvService`, so it must be
 * resolvable from THIS module's scope rather than assumed to be registered globally elsewhere.
 *
 * `ClusterService` is a Layer (see `cluster.layers.ts`) built by the app's Effect runtime over the
 * swarm ports. `ClusterSwarmEventsService` is the RxJS stream hub (Docker-event subscriptions and
 * lifecycle hooks), so it stays a Nest provider, exposed to the controller as `ClusterEventsPort`.
 */
export class ClusterModule extends createModuleContext(
    {
        imports: [SwarmCoreModule, EnvModule],
        controllers: [ClusterController],
        providers: [
            ClusterSwarmEventsService,
            { provide: SwarmClusterPort, useExisting: SwarmClusterService },
            { provide: SwarmFleetPort, useExisting: SwarmFleetService },
            { provide: SwarmParticipationPort, useExisting: SwarmParticipationService },
            { provide: ClusterNodeRepoPort, useExisting: ClusterNodeRepository },
            { provide: NodeInventoryPort, useExisting: ClusterNodeInventoryRepository },
            { provide: ClusterEnvPort, useExisting: EnvService },
            { provide: ClusterEventsPort, useExisting: ClusterSwarmEventsService },
        ],
    },
    ClusterService,
) {}

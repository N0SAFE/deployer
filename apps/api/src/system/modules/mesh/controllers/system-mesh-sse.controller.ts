import { Controller, Sse, UseGuards } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { map } from "rxjs/operators";
import { AuthGuard } from "@/core/modules/auth/guards/auth.guard";
import { SystemMeshEventService } from "@/core/modules/mesh/events/system-mesh-event.service";
import { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology.service";

@Controller("system/mesh")
export class SystemMeshSseController {
    constructor(
        private readonly meshEventService: SystemMeshEventService,
        private readonly meshTopologyService: SystemMeshTopologyService,
    ) {}

    @Sse("events")
    @UseGuards(AuthGuard)
    streamState() {
        const clusterId = this.meshTopologyService.getLocalNode().clusterId;
        return this.meshEventService.observeRuntime({
            clusterId,
            replay: true,
            replayLimit: 100,
        }).pipe(
            map(
                (event): MessageEvent => ({
                    type: "mesh-state",
                    data: event,
                }),
            ),
        );
    }
}

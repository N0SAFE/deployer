/**
 * MeshAgentModule — the API's handle on this node's mesh agent.
 *
 * Global because the agent holds the cluster-wide settings several planes read
 * (ingress lanes, the public edge's state, the node doors — via
 * `ClusterSettingsService`) and the swarm plane asks
 * it for this node's mesh address; threading an import through each of them would
 * only spread the same one-line dependency.
 */

import { Global, Module } from "@nestjs/common";

import { EnvModule } from "@/config/env/env.module";
import { ClusterSettingsService } from "./cluster-settings.service";
import { MeshAdmissionService } from "./mesh-admission.service";
import { MeshAgentBootstrapService } from "./mesh-agent-bootstrap.service";
import { MeshAgentClient } from "./mesh-agent.client";

@Global()
@Module({
	imports: [EnvModule],
	providers: [MeshAgentClient, ClusterSettingsService, MeshAdmissionService, MeshAgentBootstrapService],
	exports: [MeshAgentClient, ClusterSettingsService, MeshAdmissionService],
})
export class MeshAgentModule {}

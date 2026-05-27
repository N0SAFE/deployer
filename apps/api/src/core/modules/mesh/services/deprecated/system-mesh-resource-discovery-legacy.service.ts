import { Injectable, Logger } from "@nestjs/common";
import { SystemMeshTopologyService } from "./system-mesh-topology/orchestrator/system-mesh-topology.service";

@Injectable()
export class SystemMeshResourceDiscoveryService {
  private readonly logger = new Logger(SystemMeshResourceDiscoveryService.name);

  constructor(
    private readonly topologyService: SystemMeshTopologyService,
  ) {}

  /**
   * Discovers and retrieves resources across the mesh network.
   */
  async discoverDatabaseUrls(): Promise<string[]> {
    this.logger.debug("Discovering database URLs across the mesh...");
    // Currently returns local topology info; will be expanded with distributed mesh calls
    const readyNodes = this.topologyService.getReadyNodes();
    return readyNodes.map(node => node.nodeId);
  }
}

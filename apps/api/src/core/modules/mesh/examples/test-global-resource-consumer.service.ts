import { Injectable, Logger } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import type { Observable, Subscription } from "rxjs";
import { map } from "rxjs/operators";
import type { SystemMeshResourceDiscoveryService } from "../services/system-mesh-resource-discovery/system-mesh-resource-discovery.service";
import type { MeshChangeEvent } from "../services/system-mesh-resource-discovery/query/mesh-observable-types";
import type { Project } from "./test-deployment-mesh.service";
import { TestDeploymentMeshService } from "./test-deployment-mesh.service";

export type ProjectChangeEvent = MeshChangeEvent<Project>;

@Injectable()
export class TestGlobalResourceConsumerService implements OnModuleDestroy {
  private readonly logger = new Logger(TestGlobalResourceConsumerService.name);
  private activeSubscriptions: Subscription[] = [];

  constructor(private readonly discovery: SystemMeshResourceDiscoveryService) {}

  async getActiveProjects(): Promise<readonly Project[]> {
    const result = await this.discovery
      .from(TestDeploymentMeshService.queries.projects)
      .where({ status: "active" })
      .request();
    return result.items;
  }

  onModuleDestroy(): void {
    for (const sub of this.activeSubscriptions) {
      sub.unsubscribe();
    }
    this.activeSubscriptions = [];
  }
}

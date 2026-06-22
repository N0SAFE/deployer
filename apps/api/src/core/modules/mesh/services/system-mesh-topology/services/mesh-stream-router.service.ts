import { Injectable } from "@nestjs/common";
  import type {
      MeshStreamRoutePlanBranch,
      MeshStreamRoutePlanInput,
      MeshStreamRoutePlanResult,
  } from "@repo/contracts-entities";
    import { MeshResourceRegistryService } from "./mesh-resource-registry.service";
    import { MeshHealthMonitorService } from "./mesh-health-monitor.service";
    import { SystemMeshOverlayScopeService } from "../../system-mesh-overlay-scope.service";

  /**
   * Planification des routes de stream : lookup + pondération par métriques réseau.
   */
  @Injectable()
  export class MeshStreamRouterService {
      constructor(
          private readonly resources: MeshResourceRegistryService,
          private readonly health: MeshHealthMonitorService,
          private readonly overlayScope: SystemMeshOverlayScopeService,
      ) {}

      planRoute(input: MeshStreamRoutePlanInput): MeshStreamRoutePlanResult {
          const lookup = this.resources.lookup({
              organizationId: input.organizationId ?? null,
              kind: "stream",
              key: `stream:${input.streamId}`,
              includeCandidates: true,
          });

          const filtered = this.overlayScope.filterCandidatesByOrganization(
              lookup.candidates,
              input.organizationId ?? null,
          );

          const weighted: MeshStreamRoutePlanBranch[] = filtered.map((candidate) => {
              const edge = this.health.findBySourceAndTarget("*", candidate.ownerNodeId)
                  ?? this.health.listRanked().find((c) => c.targetNodeId === candidate.ownerNodeId);
              return {
                  ownerNodeId: candidate.ownerNodeId,
                  ownerServerUrl: candidate.ownerServerUrl,
                  endpointPath: candidate.endpointPath,
                  protocol: candidate.protocol,
                  priority: candidate.priority,
                  estimatedWeight: edge?.metrics.weight ?? 1,
              };
          });

          const sorted = weighted.sort((a, b) => {
              if (a.estimatedWeight !== b.estimatedWeight) return a.estimatedWeight - b.estimatedWeight;
              if (a.priority !== b.priority) return a.priority - b.priority;
              return a.ownerNodeId.localeCompare(b.ownerNodeId);
          });

          const selected = sorted.slice(0, Math.max(1, input.desiredBranches));

          return {
              streamId: input.streamId,
              selected,
              candidates: input.includeCandidates ? sorted : selected,
          };
      }
  }
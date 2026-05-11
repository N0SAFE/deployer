import { Injectable, Logger } from "@nestjs/common";
  import type {
      MeshResourceIndexUpsertInput,
      MeshResourceIndexUpsertResult,
      MeshResourceKind,
      MeshResourceLocation,
      MeshResourceLookupInput,
      MeshResourceLookupResult,
  } from "@repo/contracts-entities";
  import type { SystemMeshLogicService } from "../../system-mesh-logic.service";
  import type { SystemMeshClusterRepository } from "../../../repositories/system-mesh-cluster.repository";

  /**
   * Index des ressources du mesh (streams, queues, etc.) par (org, kind, key).
   * Persistance fire-and-forget avec log d'erreur explicite.
   */
  @Injectable()
  export class MeshResourceRegistryService {
      private readonly logger = new Logger(MeshResourceRegistryService.name);
      private readonly index = new Map<string, MeshResourceLocation[]>();

      constructor(
          private readonly meshLogic: SystemMeshLogicService,
          private readonly clusterRepository?: SystemMeshClusterRepository,
      ) {}

      async hydrate(): Promise<void> {
          if (!this.clusterRepository?.loadAllResourceLocations) return;
          try {
              const locations = await this.clusterRepository.loadAllResourceLocations();
              for (const loc of locations) {
                  const key = this.indexKey(loc.kind, loc.key, loc.organizationId ?? null);
                  const existing = this.index.get(key) ?? [];
                  existing.push(loc);
                  this.index.set(key, this.meshLogic.rankResourceLocations(existing));
              }
              if (locations.length > 0) {
                  this.logger.log(`Hydrated ${String(locations.length)} resource ownership entries`);
              }
          } catch (error) {
              this.logger.warn(`Resource hydration failed: ${this.errMsg(error)}`);
          }
      }

      lookup(input: MeshResourceLookupInput): MeshResourceLookupResult {
          const key = this.indexKey(input.kind, input.key, input.organizationId ?? null);
          const ranked = this.meshLogic.rankResourceLocations((this.index.get(key) ?? []).slice());
          const candidates = input.includeCandidates ? ranked : ranked.slice(0, 1);
          return { found: ranked.length > 0, query: input, primary: ranked[0] ?? null, candidates };
      }

      upsert(input: MeshResourceIndexUpsertInput): MeshResourceIndexUpsertResult {
          let replaced = 0;
          let upserted = 0;
          const orgScope = input.organizationId ?? null;

          if (input.replaceExistingForSource) {
              for (const [key, existing] of this.index) {
                  const retained = existing.filter((r) => {
                      if (r.ownerNodeId !== input.sourceNodeId) return true;
                      if (orgScope === null) return false;
                      return (r.organizationId ?? null) !== orgScope;
                  });
                  replaced += existing.length - retained.length;
                  if (retained.length === 0) this.index.delete(key);
                  else this.index.set(key, retained);
              }
          }

          for (const resource of input.resources) {
              const resourceOrg = resource.organizationId ?? orgScope;
              const normalized: MeshResourceLocation = { ...resource, organizationId: resourceOrg };
              const key = this.indexKey(normalized.kind, normalized.key, resourceOrg);
              const existing = this.index.get(key) ?? [];
              const deduped = existing.filter(
                  (r) => !(
                      r.ownerNodeId === normalized.ownerNodeId &&
                      r.ownerServerUrl === normalized.ownerServerUrl &&
                      r.endpointPath === normalized.endpointPath &&
                      r.protocol === normalized.protocol &&
                      (r.organizationId ?? null) === (normalized.organizationId ?? null)
                  ),
              );
              if (deduped.length !== existing.length) replaced += existing.length - deduped.length;
              deduped.push(normalized);
              this.index.set(key, this.meshLogic.rankResourceLocations(deduped));
              upserted += 1;
          }

          // Fire-and-forget avec log explicite (le caller reçoit accepted:true)
          if (this.clusterRepository) {
              void this.clusterRepository.persistResourceIndexUpsert(input).catch((e: unknown) => {
                  this.logger.warn(`Resource index persist failed: ${this.errMsg(e)}`);
              });
          }

          return { accepted: true, sourceNodeId: input.sourceNodeId, upserted, replaced };
      }

      removeByNode(ownerNodeId: string): void {
          for (const [key, resources] of this.index) {
              const remaining = resources.filter((r) => r.ownerNodeId !== ownerNodeId);
              if (remaining.length === 0) this.index.delete(key);
              else if (remaining.length !== resources.length) this.index.set(key, remaining);
          }
      }

      private indexKey(kind: MeshResourceKind, key: string, orgId: string | null): string {
          return `${orgId ?? "__global__"}:${kind}:${key}`;
      }

      private errMsg(e: unknown): string { return e instanceof Error ? e.message : "unknown_error"; }
  }
import { Injectable } from "@nestjs/common";
import type { MeshResourceLocation, MeshResourceLookupResult } from "@repo/contracts-entities";
import { SystemMeshTopologyService } from "../../system-mesh-topology/orchestrator/system-mesh-topology.service";

/**
 * Indexation des topics mesh dans le resource registry du mesh.
 * Séparé du registre pour respecter SRP.
 */
@Injectable()
export class MeshTopicResourceIndexService {
    constructor(
        private readonly meshTopology: SystemMeshTopologyService,
    ) {}

    indexTopics(
        namespace: string,
        topics: string[],
        organizationId: string | null,
    ): void {
        const localNode = this.meshTopology.getLocalNode();
        const now = new Date().toISOString();
        const serverUrl = this.resolveLocalServerUrl();

        const resources: MeshResourceLocation[] = topics.map((topic) => ({
            organizationId,
            kind: "topic",
            key: this.buildKey(namespace, topic),
            ownerNodeId: localNode.nodeId,
            ownerServerUrl: serverUrl,
            endpointPath: `/internal/mesh/topics/${namespace}/${topic}`,
            endpointMethod: "POST",
            protocol: "ws",
            persistentConnectionRequired: true,
            priority: 50,
            version: 1,
            updatedAt: now,
            metadata: { namespace, topic },
        }));

        this.meshTopology.upsertResourceIndex({
            organizationId,
            sourceNodeId: localNode.nodeId,
            resources,
            replaceExistingForSource: false,
        });
    }

    lookupTopic(
        namespace: string,
        topic: string,
        options?: { organizationId?: string | null; includeCandidates?: boolean },
    ): MeshResourceLookupResult {
        return this.meshTopology.lookupResource({
            organizationId: options?.organizationId ?? null,
            kind: "topic",
            key: this.buildKey(namespace, topic),
            includeCandidates: options?.includeCandidates ?? true,
        });
    }

    buildKey(namespace: string, topic: string): string {
        return `topic:${namespace}:${topic}`;
    }

    private resolveLocalServerUrl(): string {
        const candidate = process.env.APP_URL?.trim() ?? "http://localhost:3001";
        try {
            return new URL(candidate).origin;
        } catch {
            return "http://localhost:3001";
        }
    }
}
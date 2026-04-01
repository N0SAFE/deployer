import { Injectable } from "@nestjs/common";
import type {
    MeshMembershipSnapshot,
    MeshResourceLocation,
    MeshRuntimeEvent,
    MeshTopologyEvent,
} from "@repo/contracts-entities";

@Injectable()
export class SystemMeshOverlayScopeService {
    private readonly overlayNodeIdsByOrganization = new Map<string, Set<string>>();
    
    hasScopedNodes(organizationId: string): boolean {
        const scopedNodeIds = this.overlayNodeIdsByOrganization.get(organizationId);
        return Boolean(scopedNodeIds && scopedNodeIds.size > 0);
    }

    filterCandidatesByOrganization(
        candidates: MeshResourceLocation[],
        organizationId: string | null,
    ): MeshResourceLocation[] {
        if (!organizationId) {
            return candidates;
        }

        const scopedNodeIds = this.overlayNodeIdsByOrganization.get(organizationId);
        if (!scopedNodeIds || scopedNodeIds.size === 0) {
            return candidates;
        }

        return candidates.filter((candidate) => scopedNodeIds.has(candidate.ownerNodeId));
    }

    filterForwardedNodeIdsByOrganization(nodeIds: string[], organizationId: string | null): string[] {
        if (!organizationId) {
            return nodeIds;
        }

        const scopedNodeIds = this.overlayNodeIdsByOrganization.get(organizationId);
        if (!scopedNodeIds || scopedNodeIds.size === 0) {
            return nodeIds;
        }

        return nodeIds.filter((nodeId) => scopedNodeIds.has(nodeId));
    }

    isTopologyEventVisibleForOrganization(
        event: MeshTopologyEvent,
        organizationId: string | null,
    ): boolean {
        if (!organizationId) {
            return true;
        }

        const scopedNodeIds = this.overlayNodeIdsByOrganization.get(organizationId);
        if (!scopedNodeIds || scopedNodeIds.size === 0) {
            return true;
        }
        
        switch (event.type) {
            case "node_upserted":
                return scopedNodeIds.has(event.node.nodeId);
            case "node_removed":
                return scopedNodeIds.has(event.nodeId);
            case "edge_upserted":
                return scopedNodeIds.has(event.edge.sourceNodeId) || scopedNodeIds.has(event.edge.targetNodeId);
            case "edge_removed":
                return scopedNodeIds.has(event.sourceNodeId) || scopedNodeIds.has(event.targetNodeId);
            default:
                return true;
        }
    }

    scopeMembershipSnapshotByOrganization(
        snapshot: MeshMembershipSnapshot,
        organizationId: string | null,
        options?: { fallbackToUnscoped?: boolean },
    ): MeshMembershipSnapshot {
        if (!organizationId) {
            return snapshot;
        }

        const scopedNodes = snapshot.nodes.filter((node) =>
            this.metadataContainsOrganizationScope(node.metadata, organizationId),
        );
        const scopedNodeIds = new Set(scopedNodes.map((node) => node.nodeId));

        if (scopedNodeIds.size === 0) {
            return options?.fallbackToUnscoped
                ? snapshot
                : {
                      ...snapshot,
                      nodes: [],
                      connections: [],
                      sessions: [],
                  };
        }

        const scopedConnections = snapshot.connections.filter(
            (connection) =>
                scopedNodeIds.has(connection.sourceNodeId) || scopedNodeIds.has(connection.targetNodeId),
        );
        const scopedSessions = snapshot.sessions.filter(
            (session) => session.peerNodeId !== null && scopedNodeIds.has(session.peerNodeId),
        );

        return {
            ...snapshot,
            nodes: scopedNodes,
            connections: scopedConnections,
            sessions: scopedSessions,
        };
    }

    filterRuntimeEventByOrganization(event: MeshRuntimeEvent, organizationId: string): MeshRuntimeEvent {
        const scopedNodeIds = this.overlayNodeIdsByOrganization.get(organizationId);
        if (!scopedNodeIds || scopedNodeIds.size === 0) {
            return event;
        }

        const peers = event.peers.filter(
            (peer) => scopedNodeIds.has(peer.sourceNodeId) || scopedNodeIds.has(peer.targetNodeId),
        );
        const sessions = event.sessions.filter(
            (session) => session.peerNodeId !== null && scopedNodeIds.has(session.peerNodeId),
        );
        const snapshotNodes = event.snapshot.nodes.filter((node) => scopedNodeIds.has(node.nodeId));
        const snapshotConnections = event.snapshot.connections.filter(
            (connection) =>
                scopedNodeIds.has(connection.sourceNodeId) || scopedNodeIds.has(connection.targetNodeId),
        );
        const snapshotSessions = event.snapshot.sessions.filter(
            (session) => session.peerNodeId !== null && scopedNodeIds.has(session.peerNodeId),
        );
        const topologyEvent =
            event.topologyEvent && this.isTopologyEventVisibleForOrganization(event.topologyEvent, organizationId)
                ? event.topologyEvent
                : null;

        return {
            ...event,
            peers,
            sessions,
            snapshot: {
                ...event.snapshot,
                nodes: snapshotNodes,
                connections: snapshotConnections,
                sessions: snapshotSessions,
            },
            topologyEvent,
        };
    }

    upsertNodeOverlayMemberships(nodeId: string, metadata: Record<string, unknown> | null | undefined): void {
        if (!metadata || typeof metadata !== "object") {
            return;
        }

        const candidateKeys = ["organizationIds", "orgIds", "organizations"] as const;
        let orgIds: string[] = [];

        for (const key of candidateKeys) {
            const value = metadata[key];
            if (!Array.isArray(value)) {
                continue;
            }

            orgIds = value.filter((item): item is string => typeof item === "string");
            if (orgIds.length > 0) {
                break;
            }
        }

        if (orgIds.length === 0) {
            return;
        }

        this.removeNodeFromAllOverlayScopes(nodeId);

        for (const orgId of orgIds) {
            const scoped = this.overlayNodeIdsByOrganization.get(orgId) ?? new Set<string>();
            scoped.add(nodeId);
            this.overlayNodeIdsByOrganization.set(orgId, scoped);
        }
    }

    removeNodeFromAllOverlayScopes(nodeId: string): void {
        for (const [organizationId, nodeIds] of this.overlayNodeIdsByOrganization.entries()) {
            nodeIds.delete(nodeId);
            if (nodeIds.size === 0) {
                this.overlayNodeIdsByOrganization.delete(organizationId);
            }
        }
    }

    private metadataContainsOrganizationScope(
        metadata: Record<string, unknown> | null,
        organizationId: string,
    ): boolean {
        if (!metadata || typeof metadata !== "object") {
            return false;
        }

        const candidateKeys = ["organizationIds", "orgIds", "organizations"] as const;
        for (const key of candidateKeys) {
            const value = metadata[key];
            if (!Array.isArray(value)) {
                continue;
            }

            if (value.some((item) => typeof item === "string" && item === organizationId)) {
                return true;
            }
        }

        return false;
    }
}

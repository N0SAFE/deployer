import { Injectable } from "@nestjs/common";
import type {
    MeshMembershipSnapshot,
    MeshResourceLocation,
    MeshRuntimeEvent,
    MeshTopologyEvent,
} from "@repo/contracts-entities";

/**
 * Mesh overlay scoping.
 *
 * The organization concept was removed — the mesh is the single tenant, so
 * every node and every resource is visible mesh-wide. These methods are
 * intentionally passthrough (no filtering) so the call sites stay stable;
 * if per-tenant overlays are ever reintroduced they can re-scope here.
 */
@Injectable()
export class SystemMeshOverlayScopeService {
    hasScopedNodes(): boolean {
        return false;
    }

    filterCandidates(candidates: MeshResourceLocation[]): MeshResourceLocation[] {
        return candidates;
    }

    filterForwardedNodeIds(nodeIds: string[]): string[] {
        return nodeIds;
    }

    isTopologyEventVisible(event: MeshTopologyEvent): boolean {
        return true;
    }

    scopeMembershipSnapshot(snapshot: MeshMembershipSnapshot): MeshMembershipSnapshot {
        return snapshot;
    }

    scopeRuntimeEvent(event: MeshRuntimeEvent): MeshRuntimeEvent {
        return event;
    }

    upsertNodeOverlayMemberships(): void {
        // no-op — mesh-wide tenant means no per-node overlay memberships
    }

    removeNodeFromAllOverlayScopes(): void {
        // no-op
    }
}

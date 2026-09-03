import { Injectable } from "@nestjs/common";
import { Observable } from "rxjs";
import type { ContractRouterClient } from "@orpc/contract";
import type { AppContract } from "@repo/api-contracts";

export interface MeshOpenInternalBridgeInput<TEvent> {
    context: unknown;
    resourceKey: string;
    localEndpointPath: string;
    metadata: {
        streamType: string;
        streamId: string;
    };
    executeRemote: (client: ContractRouterClient<AppContract>) => PromiseLike<Observable<TEvent>>;
}

@Injectable()
export class MeshStreamRuntimeService {
    openInternalBridge<TEvent>(_input: MeshOpenInternalBridgeInput<TEvent>): Observable<TEvent> | null {
        // Cross-node deployment-stream proxying requires a registered mesh
        // stream-resource query registry, which does not exist in the current
        // discovery API (SystemMeshResourceDiscoveryService only exposes
        // registered entity query refs such as `nodeInfo`; there is no stream
        // query ref and no auto-register surface). Until that registry is
        // built, always serve the stream from the local node by returning
        // null — the honest, type-safe behavior. The remote-proxy machinery
        // (ORPC client construction, `select`/`where`/`autoRegister` DSL) was
        // removed as dead code and must be reintroduced together with the
        // stream registry.
        return null;
    }
}

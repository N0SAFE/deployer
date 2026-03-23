export interface NodeMetrics {
    cpuUsage: number;
    memoryUsage: number;
    activeStreams: number;
    queueDepth: number;
    errorRate?: number;
}

export interface ReportedResource {
    streamKey: string;
    isOwner?: boolean;
    priority?: number;
}

export interface MeshLoadReport {
    nodeId: string;
    serverUrl: string;
    organizationId: string;
    healthy?: boolean;
    reportedAt?: string;
    reportId?: string;
    originNodeId?: string;
    forwardedByNodeId?: string;
    hopCount?: number;
    metrics: NodeMetrics;
    resources?: ReportedResource[];
}

export interface RouteHintPayload {
    v: 1;
    orgId: string;
    streamKey: string;
    preferredNodeId: string;
    candidateNodeIds: string[];
    iat: number;
    exp: number;
}

export interface RouteResolveInput {
    organizationId: string;
    streamKey: string;
    targetPath?: string;
    replay?: string;
    replayLimit?: string;
}

export interface RouteCandidate {
    nodeId: string;
    serverUrl: string;
    score: number;
    healthy: boolean;
    reason: string;
}

export interface RouteResolution {
    selected: RouteCandidate | null;
    candidates: RouteCandidate[];
    routeHintToken: string | null;
    fallbackUsed: boolean;
}

export type LoadBalancerReconnectSignalReason = "upstream_unavailable" | "upstream_disconnected";

export interface LoadBalancerReconnectSignal {
    type: "lb_reconnect";
    reason: LoadBalancerReconnectSignalReason;
    retryAfterMs: number;
    selectedNodeId?: string;
    routeHintToken?: string | null;
    fallbackUsed?: boolean;
}
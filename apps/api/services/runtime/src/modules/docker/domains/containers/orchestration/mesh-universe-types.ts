/** The shapes and priorities the mesh container universe is merged with. */
import { type DockerContainer } from "@deployer/contracts-entities";

import type { DockerContainerListResponsePayload } from "../mesh/node-mesh-types";

export const STATUS_PRIORITY: Record<DockerContainer["status"], number> = {
    dead: 6,
    exited: 5,
    restarting: 4,
    paused: 3,
    created: 2,
    unknown: 1,
    running: 0,
};

export const HEALTH_PRIORITY: Record<DockerContainer["health"], number> = {
    unhealthy: 3,
    starting: 2,
    none: 1,
    healthy: 0,
};

export type ParsedFilterEntry = {
    operator: string;
    value: unknown;
}

export type DockerListMeta = {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
}

export type DockerListResult<T> = {
    data: T[];
    meta: DockerListMeta;
}

export type DockerGroupedDaemonDiagnostics = {
    hasSharedDaemonAcrossNodes: boolean;
    sharedDaemonGroups: {
        daemonId: string;
        nodeIds: string[];
    }[];
}

export type DockerContainerResolutionOptions = {
    localOnly?: boolean;
}

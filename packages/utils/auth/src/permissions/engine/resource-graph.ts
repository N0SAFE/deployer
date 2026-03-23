/**
 * resource-graph.ts
 *
 * RESOURCE_GRAPH defines the FK relationships used for:
 *   1. Cascade scope resolution  — follow the parent chain to check inherited access.
 *   2. Dot-notation field resolution in DFilter — resolve "service.project.name" etc.
 *
 * The graph is keyed by resource name and describes:
 *   - `table`    : the exact DB table name (as in Drizzle schema)
 *   - `idField`  : the primary-key column name on that table
 *   - `parent`   : direct parent resource + FK column + parent table name (null for roots)
 */

import type { ProjectResource } from "./types";

export interface ResourceNode {
    /** DB table name (exact, as declared in Drizzle schema). */
    table: string;
    /** Primary key column name on this table. */
    idField: string;
    /** Parent relationship, or null if this is a root resource. */
    parent: ResourceParent | null;
}

export interface ResourceParent {
    /** The parent resource type. */
    resource: ProjectResource;
    /** FK column on the *child* table referencing the parent's PK. */
    foreignKey: string;
    /** Parent's DB table name (for convenience in query builders). */
    table: string;
}

export type ResourceGraph = Record<ProjectResource, ResourceNode>;

export const RESOURCE_GRAPH: ResourceGraph = {
    project: {
        table: "projects",
        idField: "id",
        parent: null,
    },
    service: {
        table: "services",
        idField: "id",
        parent: {
            resource: "project",
            foreignKey: "projectId",
            table: "projects",
        },
    },
    deployment: {
        table: "deployments",
        idField: "id",
        parent: {
            resource: "service",
            foreignKey: "serviceId",
            table: "services",
        },
    },
    logs: {
        table: "deployment_logs",
        idField: "id",
        parent: {
            resource: "deployment",
            foreignKey: "deploymentId",
            table: "deployments",
        },
    },
    webhook: {
        table: "webhooks",
        idField: "id",
        parent: {
            resource: "project",
            foreignKey: "projectId",
            table: "projects",
        },
    },
    apiKey: {
        table: "api_keys",
        idField: "id",
        parent: {
            resource: "project",
            foreignKey: "projectId",
            table: "projects",
        },
    },
    /**
     * `environment` is a conceptual resource (deployment-config scoped to a project).
     * It does not have its own DB table. Engine treats it as project-scoped:
     * cascade resolution stops at `project`, filter fields come from `projects` row.
     */
    environment: {
        table: "projects",
        idField: "id",
        parent: null,
    },
} as const;

// ---------------------------------------------------------------------------
// Ancestor chain helpers
// ---------------------------------------------------------------------------

/**
 * Maximum cascade depth (safety cap — the graph is acyclic by design,
 * but this prevents accidental infinite loops during graph edits).
 */
export const MAX_CASCADE_DEPTH = 50;

/**
 * Returns the full ordered ancestor chain for a given resource type.
 *
 * @example
 *   getAncestorChain("logs")
 *   // → ["deployment", "service", "project"]
 *
 * @throws If the chain exceeds MAX_CASCADE_DEPTH (indicates a cycle).
 */
export function getAncestorChain(resource: ProjectResource): ProjectResource[] {
    const chain: ProjectResource[] = [];
    let cursor: ProjectResource = resource;

    for (;;) {
        const node: ResourceNode = RESOURCE_GRAPH[cursor];
        if (node.parent === null) break;
        chain.push(node.parent.resource);
        cursor = node.parent.resource;

        if (chain.length >= MAX_CASCADE_DEPTH) {
            throw new Error(
                `Ancestor chain for resource "${resource}" exceeded MAX_CASCADE_DEPTH (${String(MAX_CASCADE_DEPTH)}). ` +
                    `Possible cycle in RESOURCE_GRAPH.`,
            );
        }
    }

    return chain;
}

/**
 * Returns true if `ancestor` is a direct or transitive parent of `resource`.
 */
export function isAncestorOf(
    ancestor: ProjectResource,
    resource: ProjectResource,
): boolean {
    return getAncestorChain(resource).includes(ancestor);
}

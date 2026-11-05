import type { DockerodeNodeSummary } from '@deployer/contracts-entities'

/**
 * The engine's OWN swarm vocabulary, kept inside this boundary: business code
 * reads the platform vocabulary (`ClusterSwarmRole`) instead.
 *
 * `Role` has no `none` because the engine only reports nodes that exist.
 */
export type SwarmNodeRole = 'manager' | 'worker'
export type SwarmNodeAvailability = 'active' | 'pause' | 'drain'

/**
 * The node shape the payload builder needs.
 *
 * `Spec` and its fields are OPTIONAL because this also accepts a raw engine
 * payload that has not been through `dockerodeNodeSummarySchema` yet. The engine
 * omits fields it considers default, and echoing an omitted field as `""` is
 * exactly what produced `400 invalid Role: ""` on every node update.
 */
export type SwarmNodeSpecSource = {
    Spec?: {
        Name?: string
        Role?: string
        Availability?: string
        Labels?: Record<string, string>
    }
}

/**
 * The FLAT `NodeSpec` body of `POST /nodes/{id}/update`. A nested `Spec`
 * wrapper makes the daemon read an empty top-level `Role` and reject the call.
 */
export type SwarmNodeSpecPayload = {
    /** Left out entirely when the engine reported no name — never sent as `""`. */
    Name?: string
    Role: SwarmNodeRole
    Availability: SwarmNodeAvailability
    Labels: Record<string, string>
}

/** A partial change applied over the node's CURRENT spec. */
export type SwarmNodeSpecChange = {
    role?: SwarmNodeRole
    availability?: SwarmNodeAvailability
    /** COMPLETE desired label map — see `buildSwarmNodeSpecPayload`. */
    labels?: Record<string, string>
}

/** Names the write in logs — the operation, not the values (never log payloads). */
export type SwarmNodeSpecOperation = 'labels' | 'role/availability'

/**
 * Build the body for `POST /nodes/{id}/update` — the FLAT `NodeSpec`.
 *
 * The Engine API wants the spec at the TOP LEVEL and `version` in the QUERY
 * STRING (dockerode routes those through `_query` / `_body`). Wrapping the
 * spec in a nested `Spec` makes the daemon read an empty top-level `Role` and
 * reject EVERY node update with `400 invalid Role: ""`.
 *
 * `labels` is the COMPLETE desired label map, not a patch: merging over the existing labels would
 * resurrect a label the caller deliberately dropped.
 */
export function buildSwarmNodeSpecPayload(
    node: SwarmNodeSpecSource,
    change: SwarmNodeSpecChange
): SwarmNodeSpecPayload {
    const spec = node.Spec ?? {}
    const name = spec.Name ?? ''
    return {
        // Omitted rather than sent as "": the engine already knows the name.
        ...(name.length > 0 ? { Name: name } : {}),
        // Never echo `""` — a node reports it transiently right after init — and never fall back to
        // `worker`: demoting a manager can leave the cluster with no manager at all, so an unreadable
        // role stays `manager`.
        Role: change.role ?? normalizeSwarmNodeRole(spec.Role) ?? 'manager',
        Availability:
            change.availability ??
            swarmNodeAvailabilityOrDefault(spec.Availability),
        Labels: change.labels ?? spec.Labels ?? {},
    }
}

/** The node's role as the engine reports it; a node with a manager status is a manager. */
export function resolveSwarmNodeRole(
    node: DockerodeNodeSummary
): SwarmNodeRole {
    if (node.ManagerStatus !== null) return 'manager'
    return normalizeSwarmNodeRole(node.Spec.Role) ?? 'manager'
}

function normalizeSwarmNodeRole(
    value: string | undefined
): SwarmNodeRole | null {
    const role = (value ?? '').trim().toLowerCase()
    return role === 'manager' || role === 'worker' ? role : null
}

function swarmNodeAvailabilityOrDefault(
    value: string | undefined
): SwarmNodeAvailability {
    return value === 'pause' || value === 'drain' ? value : 'active'
}

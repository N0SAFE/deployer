import type { Hlc } from "../../../shared/primitives/hybrid-logical-clock";

/**
 * Wrapper enrichi qui ajoute une HLC au-dessus de l'état NodeState
 * provenant de @repo/contracts-entities (qui ne change pas).
 */
export interface VersionedNodeState<T> {
    readonly state: T;
    readonly hlc: Hlc;
}

export interface VersionedEdge<T> {
    readonly edge: T;
    readonly hlc: Hlc;
}
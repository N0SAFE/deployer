import type {
    MeshDirectProtocol,
    MeshResourceLocation,
} from "@repo/contracts-entities";

/**
 * État interne immutable du MeshResourceQueryBuilder.
 * Accumule les contraintes au fil des appels `.where()`.
 */
export interface MeshResourceQueryState {
    readonly key: string | null;
    readonly includeCandidates: boolean;
    readonly protocol?: MeshDirectProtocol;
    readonly ownerNodeId?: string;
    readonly endpointMethod?: MeshResourceLocation["endpointMethod"];
    readonly metadata: Readonly<Record<string, unknown>>;
}

export const defaultQueryState: MeshResourceQueryState = {
    key: null,
    includeCandidates: true,
    metadata: {},
};

/**
 * Input de la surcharge `.where(object)` — contraintes déclaratives.
 */
export interface MeshResourceQueryWhereInput {
    key?: string;
    includeCandidates?: boolean;
    protocol?: MeshDirectProtocol;
    ownerNodeId?: string;
    endpointMethod?: MeshResourceLocation["endpointMethod"];
    metadata?: Record<string, unknown>;
}

/**
 * Applique un MeshResourceQueryWhereInput sur un état existant.
 * Retourne un nouvel état (immutable).
 */
export function applyWhereInput(
    state: MeshResourceQueryState,
    input: MeshResourceQueryWhereInput,
): MeshResourceQueryState {
    return {
        ...state,
        metadata: { ...state.metadata, ...(input.metadata ?? {}) },
        ...(input.key !== undefined ? { key: input.key } : {}),
        ...(input.includeCandidates !== undefined ? { includeCandidates: input.includeCandidates } : {}),
        ...(input.protocol !== undefined ? { protocol: input.protocol } : {}),
        ...(input.ownerNodeId !== undefined ? { ownerNodeId: input.ownerNodeId } : {}),
        ...(input.endpointMethod !== undefined ? { endpointMethod: input.endpointMethod } : {}),
    };
}
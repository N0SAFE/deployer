import type { AnyRecord } from "../types/mesh-resource-discovery-types";
import type { MeshResourceQueryState } from "./mesh-resource-query-state";
import type { MeshDirectProtocol, MeshResourceLocation } from "@repo/contracts-entities";
import type { MeshFieldRef } from "./mesh-field-ref";

// ─── Symbole d'identification ─────────────────────────────────────────────────

export const meshExpressionSymbol = Symbol("mesh-expression");

// ─── Interface publique ───────────────────────────────────────────────────────

export interface MeshWhereExpression<TRecord extends AnyRecord = AnyRecord> {
    readonly [meshExpressionSymbol]: true;
    /** Prédicat appliqué sur chaque candidat. */
    readonly test: (record: TRecord) => boolean;
    /**
     * Hint optionnel pour propager une contrainte connue dans le QueryState
     * (ex: eq(fields.key, "x") → state.key = "x").
     * Permet d'optimiser le lookup mesh en passant la clé directement.
     */
    readonly applyState?: (state: MeshResourceQueryState) => MeshResourceQueryState;
}

// ─── Guard ────────────────────────────────────────────────────────────────────

export function isExpression(value: unknown): value is MeshWhereExpression {
    return Boolean(
        value &&
        typeof value === "object" &&
        meshExpressionSymbol in value,
    );
}

// ─── Factory interne ──────────────────────────────────────────────────────────

export function makeExpression<TRecord extends AnyRecord>(input: {
    test: (record: TRecord) => boolean;
    applyState?: (state: MeshResourceQueryState) => MeshResourceQueryState;
}): MeshWhereExpression<TRecord> {
    return {
        [meshExpressionSymbol]: true,
        test: input.test,
        applyState: input.applyState,
    };
}

// ─── Utilitaire de résolution de chemin ───────────────────────────────────────

export function resolvePathValue(
    record: AnyRecord,
    key: string,
    pathSegments: readonly string[],
): unknown {
    let current: unknown = record[key];
    for (const segment of pathSegments) {
        if (!current || typeof current !== "object") return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
}

// ─── State hint builder pour eq() ────────────────────────────────────────────
//
// Quand on fait eq(fields.key, "my-key"), on peut propager directement
// state.key = "my-key" pour éviter un lookup mesh sans clé.

export function buildEqStateHint<TRecord extends AnyRecord, TValue>(
    field: MeshFieldRef<TRecord, TValue>,
    value: TValue,
): ((state: MeshResourceQueryState) => MeshResourceQueryState) | undefined {
    if (field.path.length > 0) return undefined;

    switch (field.rootKey) {
        case "key":
            if (typeof value === "string") {
                return (state) => ({ ...state, key: value });
            }
            return undefined;

        case "protocol":
            if (typeof value === "string") {
                return (state) => ({ ...state, protocol: value as MeshDirectProtocol });
            }
            return undefined;

        case "ownerNodeId":
            if (typeof value === "string") {
                return (state) => ({ ...state, ownerNodeId: value });
            }
            return undefined;

        case "endpointMethod":
            if (typeof value === "string") {
                return (state) => ({
                    ...state,
                    endpointMethod: value as MeshResourceLocation["endpointMethod"],
                });
            }
            return undefined;

        default:
            return undefined;
    }
}
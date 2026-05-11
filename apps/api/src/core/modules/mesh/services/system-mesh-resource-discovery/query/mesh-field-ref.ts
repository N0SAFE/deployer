import z from "zod/v4";
import type { AnyRecord, SchemaRecordOutput } from "../types/mesh-resource-discovery-types";

// ─── Symboles ─────────────────────────────────────────────────────────────────

export const meshFieldRefSymbol = Symbol("mesh-field-ref");

// ─── Types ────────────────────────────────────────────────────────────────────

export type MeshFieldKey<TRecord> = Extract<keyof TRecord, string>;

export interface MeshFieldRef<TRecord extends AnyRecord, TValue> {
    readonly [meshFieldRefSymbol]: true;
    readonly key: MeshFieldKey<TRecord>;
    readonly path: readonly string[];
    readonly rootKey: string;
    readonly __valueType?: TValue;
}

export type MeshFieldMap<TRecord extends AnyRecord> = {
    [K in MeshFieldKey<TRecord>]-?: MeshFieldRef<TRecord, TRecord[K]>;
};

// ─── Factory interne ──────────────────────────────────────────────────────────

export function makeFieldRef<TRecord extends AnyRecord, TValue>(
    key: MeshFieldKey<TRecord>,
    pathSegments: readonly string[] = [],
): MeshFieldRef<TRecord, TValue> {
    return {
        [meshFieldRefSymbol]: true,
        key,
        path: pathSegments,
        rootKey: key,
    };
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Génère une map de field refs typés depuis un schema Zod objet.
 *
 * @example
 * const f = meshFields(meshStreamResourceSchema);
 * query.where(eq(f.ownerNodeId, "node-1"));
 */
export function meshFields<TSchema extends z.ZodType>(
    schema: TSchema,
): MeshFieldMap<SchemaRecordOutput<TSchema>> {
    if (!(schema instanceof z.ZodObject)) {
        throw new Error("meshFields(schema) requires a Zod object schema.");
    }

    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const refs: Partial<MeshFieldMap<SchemaRecordOutput<TSchema>>> = {};

    for (const key of Object.keys(shape)) {
        refs[key as MeshFieldKey<SchemaRecordOutput<TSchema>>] = makeFieldRef(
            key as MeshFieldKey<SchemaRecordOutput<TSchema>>,
        );
    }

    return refs as MeshFieldMap<SchemaRecordOutput<TSchema>>;
}

/**
 * Navigue dans un champ imbriqué via des segments de chemin.
 *
 * @example
 * const f = meshFields(meshStreamResourceSchema);
 * query.where(eq(path(f.metadata, "region"), "eu-west-1"));
 */
export function path<TRecord extends AnyRecord, TValue>(
    field: MeshFieldRef<TRecord, TValue>,
    ...pathSegments: string[]
): MeshFieldRef<TRecord, unknown> {
    return {
        [meshFieldRefSymbol]: true,
        key: field.key,
        rootKey: field.rootKey,
        path: [...field.path, ...pathSegments],
    };
}
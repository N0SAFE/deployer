import type {
    MeshDirectProtocol,
    MeshResourceKind,
    MeshResourceLocation,
    MeshResourceLookupResult,
} from "@repo/contracts-entities";
import type { output, ZodType } from "zod/v4";

// ─── Utilitaires de types ─────────────────────────────────────────────────────

export type AnyRecord<TValue = unknown> = Record<string, TValue>;

export type SchemaRecordOutput<TSchema extends ZodType> =
    output<TSchema> extends AnyRecord
        ? output<TSchema>
        : never;

export type MeshResourceOfKind<TKind extends MeshResourceKind> =
    Omit<MeshResourceLocation, "kind"> & { kind: TKind };

export type MeshCandidatePredicate<
    TCandidate extends MeshResourceLocation = MeshResourceLocation,
> = (candidate: TCandidate) => boolean;

// ─── Résultat de découverte ───────────────────────────────────────────────────

export interface MeshResourceDiscoveryResult<TOutput> {
    found: boolean;
    query: MeshResourceLookupResult["query"];
    primary: TOutput | null;
    candidates: TOutput[];
}

// ─── Accesseur topologie (interface pour testabilité) ─────────────────────────

export interface MeshResourceTopologyAccessor {
    getLocalNode(): { nodeId: string };
    lookupResource(input: {
        organizationId?: string | null;
        kind: MeshResourceKind;
        key: string;
        includeCandidates: boolean;
    }): MeshResourceLookupResult;
    upsertResourceIndex(input: {
        organizationId?: string | null;
        sourceNodeId: string;
        replaceExistingForSource: boolean;
        resources: MeshResourceLocation[];
    }): unknown;
}

// ─── Inputs ───────────────────────────────────────────────────────────────────

export interface MeshResourceAutoRegisterInput {
    organizationId?: string | null;
    key: string;
    ownerServerUrl: string;
    endpointPath: string;
    endpointMethod?: MeshResourceLocation["endpointMethod"];
    protocol: MeshDirectProtocol;
    persistentConnectionRequired?: boolean;
    abortEndpointPath?: string;
    priority?: number;
    version?: number;
    metadata?: Record<string, unknown> | null;
}
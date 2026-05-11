import { Injectable } from "@nestjs/common";
import z from "zod/v4";
import type { MeshResourceKind, MeshResourceLocation } from "@repo/contracts-entities";
import { SystemMeshTopologyService } from "../system-mesh-topology/orchestrator/system-mesh-topology.service";
import { registeredSchemaKinds } from "./schemas/mesh-resource-kind-schemas";
import { MeshResourceQueryBuilder } from "./query/mesh-resource-query-builder";
import type {
    MeshResourceOfKind,
    SchemaRecordOutput,
} from "./types/mesh-resource-discovery-types";

// Re-exports publics pour les consommateurs
export { meshFields, path } from "./query/mesh-field-ref";
export {
    eq, neq, inArray, contains, startsWith, endsWith,
    exists, and, or, not,
} from "./query/mesh-where-operators";
export type { MeshWhereExpression } from "./query/mesh-where-expression";
export type { MeshFieldRef, MeshFieldMap } from "./query/mesh-field-ref";
export type {
    MeshResourceDiscoveryResult,
    MeshResourceTopologyAccessor,
    MeshResourceAutoRegisterInput,
} from "./types/mesh-resource-discovery-types";
export {
    meshDeploymentResourceSchema,
    meshStreamResourceSchema,
    meshLogResourceSchema,
    meshQueueResourceSchema,
    meshTopicResourceSchema,
} from "./schemas/mesh-resource-kind-schemas";
export { MeshResourceQueryBuilder } from "./query/mesh-resource-query-builder";
export { MeshResourceSubQueryBuilder } from "./query/mesh-resource-sub-query-builder";

/**
 * Point d'entrée NestJS pour la découverte de ressources mesh.
 *
 * Usage :
 * ```ts
 * // Par kind string
 * discovery.select("stream").where({ key: "stream:xyz" }).first()
 *
 * // Par schema typé
 * const f = meshFields(meshStreamResourceSchema);
 * discovery
 *   .select(meshStreamResourceSchema)
 *   .where(eq(f.ownerNodeId, "node-1"))
 *   .list()
 * ```
 */
@Injectable()
export class SystemMeshResourceDiscoveryService {
    constructor(
        private readonly topologyService: SystemMeshTopologyService,
    ) {}

    // Surcharge 1 : select par kind string
    select<TKind extends MeshResourceKind>(
        kind: TKind,
    ): MeshResourceQueryBuilder<MeshResourceOfKind<TKind>, MeshResourceOfKind<TKind>>;

    // Surcharge 2 : select par schema Zod (kind inféré depuis registeredSchemaKinds)
    select<TSchema extends z.ZodType>(
        schema: TSchema,
        kind?: MeshResourceKind,
    ): MeshResourceQueryBuilder<
        SchemaRecordOutput<TSchema> & MeshResourceLocation,
        SchemaRecordOutput<TSchema> & MeshResourceLocation
    >;

    select<TSchema extends z.ZodType, TKind extends MeshResourceKind>(
        kindOrSchema: TKind | TSchema,
        kind?: MeshResourceKind,
    ): unknown {
        if (typeof kindOrSchema === "string") {
            return MeshResourceQueryBuilder.create(this.topologyService, kindOrSchema);
        }

        const resolvedKind = kind ?? registeredSchemaKinds.get(kindOrSchema);
        if (!resolvedKind) {
            throw new Error(
                "Unable to infer mesh resource kind from schema. " +
                "Pass select(schema, kind) or use a registered schema " +
                "like meshStreamResourceSchema.",
            );
        }

        return MeshResourceQueryBuilder.create(this.topologyService, resolvedKind)
            .narrow(kindOrSchema);
    }
}
import type { z, ZodTypeAny } from "zod";
import type { MeshEntity } from "../mesh-entity";
import type { MeshQuery } from "../mesh-query";
import type { MeshQueryBuilder } from "../query/mesh-query-builder";

export type AnyMeshEntity = MeshEntity<string, ZodTypeAny, any, any, any>;

export type AnyMeshQuery = MeshQuery<ZodTypeAny, ZodTypeAny> & { itemSchema: ZodTypeAny };

export type BuilderResultShape<TBuilder> = TBuilder extends MeshQueryBuilder<infer T> ? T : never;

import type { MeshQueryBuilder } from "./services/system-mesh-resource-discovery/query/mesh-query-builder";

// Re-export canonical types for convenience
export type { AnyMeshEntity } from "./mesh-entity";
export type { AnyMeshQuery } from "./mesh-query";
export type { AnyMeshMutation } from "./mesh-mutation";

// ─── Builder shape extractors ─────────────────────────────────────────────────

/**
 * Extracts TResultShape from a MeshQueryBuilder.
 */
export type BuilderResultShape<TBuilder> =
  TBuilder extends MeshQueryBuilder<infer _TItem, infer TResult>
    ? TResult
    : never;

import type { MeshQueryBuilder } from './mesh-query-builder';

// Extracts the result shape from a builder
export type BuilderResultShape<TBuilder> = TBuilder extends MeshQueryBuilder<any, infer TResult>
  ? TResult
  : never;

// Describes the structure for a join operation
export interface JoinConfig<TLeft, TRight, TAlias extends string> {
  alias: TAlias;
  on: (left: TLeft, right: TRight) => boolean;
  type: 'inner' | 'left';
}

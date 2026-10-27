import type { NodeConfigRepository } from "@deployer/nest-nodes/node-config.repository";

/**
 * The slice of `NodeConfigRepository` the setup wizard's own services use.
 *
 * ── WHY A NARROW PORT AND NOT THE CONCRETE CLASS ────────────────────────────
 * `NodeConfigRepository` is an `@Injectable` CLASS with a PRIVATE `localDb`, so a
 * test double cannot be built structurally: TypeScript demands `localDb`,
 * `getMeshSharedSecret` and `updateMeshPeers` even though the wizard never calls
 * them, and a private member cannot be faked at all.
 *
 * The consequence was 4 permanent type errors in `apps/setup`'s specs — and a
 * type-check that is ALWAYS red is a type-check nobody reads, so the next real
 * error arrives unnoticed.
 *
 * The wizard reads `find()` and writes `upsert()`. Nothing else. Depending on
 * exactly that is the honest dependency and a testable one: the Nest container
 * still injects the real repository, because a class satisfies a `Pick` of itself.
 *
 * ── WHY `Pick` OF THE REAL CLASS RATHER THAN A RESTATED SHAPE ───────────────
 * A hand-written interface would be a second source of truth for `node_config`
 * and would drift the moment the repository's signature changed. `Pick` derives
 * from the class, so a breaking change there becomes an error here.
 */

/** Read-only: services that only answer "what does this node have?". */
export type NodeConfigReader = Pick<NodeConfigRepository, "find">;

/** Read + persist: the gate writes the operator's choices before the API starts. */
export type NodeConfigStore = Pick<NodeConfigRepository, "find" | "upsert">;

/**
 * Runtime DI tokens for the two ports.
 *
 * A `Pick<…>` is a TYPE, so it has no runtime identity and Nest cannot use it as a
 * provider token — binding one produces
 * "Nest can't resolve dependencies of the SetupGateService (…)".
 *
 * Two distinct symbols (not one shared) so the read-only and read-write
 * capabilities stay separable in the graph: a consumer that must not write cannot
 * accidentally be handed the store. Both resolve to the SAME repository instance
 * (see `useExisting` in the module), so "one repository, narrower views" holds.
 */
export const NODE_CONFIG_READER = Symbol("NodeConfigReader");
export const NODE_CONFIG_STORE = Symbol("NodeConfigStore");

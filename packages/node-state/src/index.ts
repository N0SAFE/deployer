/**
 * @deployer/node-state — this node's own state, as Effect.
 *
 * The local SQLite database (opened and migrated once per layer, closed with its scope), the node's
 * config, its row in the cluster snapshot, the fleet inventory cache, and the swarm node label
 * vocabulary those rows mirror. The setup app reads the cluster decision from here before the global
 * Postgres exists and the API reads the same rows afterwards. Nest apps mount it through
 * `@deployer/nest-effect/node-state`.
 */
export { LocalDatabaseError, NodeStateConflict } from "./database/errors";
export {
	LocalDatabase,
	makeLocalDatabase,
	makeLocalDatabaseFrom,
	migrateLocalDatabase,
	openLocalDatabase,
} from "./database/local-database";
export type { LocalDatabaseShape, LocalDb } from "./database/local-database";
export type { LocalDatabaseOptions } from "./database/options";

export { makeNodeConfigRepository, NodeConfigRepository } from "./nodes/node-config.repository";
export type { NodeConfigRepositoryShape, NodeConfigRow } from "./nodes/node-config.repository";
export { ClusterNodeRepository, makeClusterNodeRepository } from "./nodes/cluster-node.repository";
export type { ClusterNodeRepositoryShape } from "./nodes/cluster-node.repository";
export { ClusterNodeInventoryRepository, makeClusterNodeInventoryRepository } from "./nodes/cluster-node-inventory.repository";
export type { ClusterNodeInventoryRepositoryShape } from "./nodes/cluster-node-inventory.repository";
export { toEngineNodeRow } from "./nodes/engine-node-row";
export type { EngineNodeRow } from "./nodes/engine-node-row";

export {
	ingressFromLabels,
	platformRoleForPolicy,
	platformRoleFromLabels,
	resolveSwarmNodeRole,
	SWARM_NODE_LABEL_INGRESS,
	SWARM_NODE_LABEL_REGION,
	SWARM_NODE_LABEL_ROLE,
	SWARM_NODE_LABEL_TENANT_PREFIX,
	withIngress,
	withPlatformRole,
} from "./labels/swarm-node-labels";

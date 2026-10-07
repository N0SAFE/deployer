/**
 * @repo/nest-nodes — the LOCAL node-state surface.
 *
 * WHAT THIS PACKAGE IS
 * Everything that reads or writes this node's own state in the LOCAL SQLite
 * database (`node_config`, `cluster_node`, `cluster_nodes`), plus the swarm node
 * LABEL vocabulary those rows mirror:
 *   - `NodeConfigRepository`          — the node's own config (DB URL, swarm choice)
 *   - `ClusterNodeRepository`         — this node's row in the cluster inventory
 *   - `ClusterNodeInventoryRepository`— the local CACHE of `docker node ls`
 *   - `swarm-node-labels`             — label keys, role mapping, role resolution
 *
 * WHY IT IS SHARED
 * The setup app reads `node_config` to learn the cluster decision before the
 * global Postgres exists, and the API reads the same table afterwards. Both apps
 * need the same rows with the same shape.
 *
 * WHY IT IS ITS OWN PACKAGE (DI graph)
 * These repositories were reachable only through the setup FEATURE module, which
 * closed a cycle: `MeshCoreModule -> SetupModule -> CoreInitializationModule ->
 * SwarmCoreModule -> MeshCoreModule`. The repositories themselves depend on
 * nothing but the local database and the node vocabulary, so extracting them is
 * what lets `swarm`, `mesh` and `setup` all consume node state without any of
 * them importing each other.
 *
 * WHAT IT IS NOT
 * No migrations, no connection pool, no boot policy. The SQLite file itself
 * belongs to `@repo/nest-database-local`.
 */
export { NodeConfigRepository } from "./node-config.repository";
export type { NodeConfigRow } from "./node-config.repository";
// `SetupState` is the local schema's own union — re-exported so consumers of
// node state do not need a second import from the schema package.
export type { SetupState } from "@repo/nest-schema/local/node-config";

export { ClusterNodeRepository } from "./cluster-node.repository";
export { NodesModule } from "./nodes.module";
export type { NodesModuleOptions } from "./nodes.module";

export { ClusterNodeInventoryRepository } from "./cluster-node-inventory.repository";

export {
	SWARM_NODE_LABEL_INGRESS,
	SWARM_NODE_LABEL_ROLE,
	SWARM_NODE_LABEL_REGION,
	SWARM_NODE_LABEL_TENANT_PREFIX,
	platformRoleForPolicy,
	platformRoleFromLabels,
	ingressFromLabels,
	withPlatformRole,
	withIngress,
	resolveSwarmNodeRole,
} from "./swarm-node-labels";
export type { SwarmNodeRole, SwarmNodeRoleSource } from "./swarm-node-labels";

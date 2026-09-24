/**
 * @repo/nest-swarm — swarm cluster primitives, driven through the Docker
 * engine API (never the CLI).
 *
 * WHAT THIS PACKAGE IS
 *   - `SwarmClusterService`      — init/join, membership wait, the typed
 *                                  cluster snapshot, join tokens, node
 *                                  inventory pass-through
 *   - `SwarmParticipationService` — the create/join decision + the local node
 *                                  POLICY (role, availability, labels)
 *   - `SwarmBootstrapService`    — converges from the PERSISTED decision at
 *                                  boot and on demand after setup
 *   - `SwarmJoinGrantService`    — the fleet's answer to "may this joiner be a
 *                                  manager?" (Raft odd-quorum rule)
 *   - `SwarmLeadershipService`   — master election, watchdog, takeover
 *   - `SwarmFleetService`        — services/tasks/node-resource read-models
 *   - `MasterScorer`, `QuorumPlanner` — the pure election math
 *   - `toSwarmPlacement`         — placement policy → constraints/preferences
 *
 * HOW TO REGISTER IT
 *   SwarmModule.forRoot({ election, join, participation })          — values
 *   SwarmModule.forRootAsync({ inject: [EnvService], useFactory })  — via DI
 *
 * The app passes the VALUES; the package owns the WIRING. It reads NO
 * environment variables and ships NO defaults for platform behaviour — which
 * variable carries an election cadence is an app convention, so the app
 * resolves it and hands the value over.
 *
 * `forRoot` is also what fixes a subtle injection bug: a bare
 * `@Optional() provider?: SomeInterface` resolves to `Object` at runtime (an
 * interface erases), so Nest injects an arbitrary provider. Declaring tokens
 * and binding them here makes that impossible.
 */

export { SwarmModule } from "./swarm.module";
export type { SwarmModuleOptions, SwarmModuleAsyncOptions } from "./swarm.module";

export type {
	SwarmElectionConfig,
	SwarmJoinConfig,
	SwarmParticipationDefaults,
} from "./swarm-config";
export {
	SWARM_ELECTION_CONFIG,
	SWARM_JOIN_CONFIG,
	SWARM_PARTICIPATION_DEFAULTS,
	SWARM_METRICS_PROVIDER,
	SWARM_LEADERSHIP_EVENT_SINK,
} from "./swarm-config";

export { SwarmClusterService } from "./services/swarm-cluster.service";
export { SwarmParticipationService } from "./services/swarm-participation.service";
export { SwarmBootstrapService } from "./services/swarm-bootstrap.service";
export { SwarmJoinGrantService } from "./services/swarm-join-grant.service";
export { SwarmFleetService } from "./services/swarm-fleet.service";

export {
	toSwarmPlacement,
	parsePlacementPolicyLabel,
} from "./services/node-placement.service";
export type {
	SwarmPlacementPlan,
	PlacementPolicy,
	PlacementPolicyInput,
} from "./services/node-placement.service";

export { SwarmLeadershipService, MASTER_CHANGED_EVENT } from "./election/swarm-leadership.service";
export type {
	MasterChangedEvent,
	LeadershipEventSink,
	ClusterMetricsProvider,
} from "./election/swarm-leadership.service";

export {
	scoreCandidate,
	selectMasterWinner,
	isEligibleAsMaster,
	buildMasterScoreResult,
	DEFAULT_MASTER_SCORER_WEIGHTS,
} from "./election/master-scorer";
export type {
	MasterCandidateMetrics,
	MasterScorerWeights,
	MasterScoreResult,
} from "./election/master-scorer";
export { planQuorum, isQuorumIntact } from "./election/quorum-planner";
export type { QuorumPlan } from "./election/quorum-planner";

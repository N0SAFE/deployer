/**
 * @deployer/swarm — Docker Swarm cluster management as Effect.
 *
 * The cluster snapshot and bootstrap, the fleet view, node placement, this node's participation
 * (create, join, policy), the join grant a fleet gives a joining node, and the master election. They run
 * on `@deployer/docker`'s engine and `@deployer/node-state`; A Nest app provides each tag from `makeSwarmServices`.
 */
export {
    SwarmConflict,
    SwarmInvalid,
    SwarmTimeout,
    SwarmUnavailable,
} from './errors'

export {
    SwarmElectionConfigService,
    SwarmJoinConfigService,
    SwarmParticipationDefaultsService,
} from './config'
export type {
    SwarmElectionConfig,
    SwarmJoinConfig,
    SwarmParticipationDefaults,
} from './config'

export { makeSwarmServices } from './compose'
export type {
    SwarmServices,
    SwarmServicesDeps,
    SwarmServicesOptions,
} from './compose'

export { SwarmCluster } from './cluster/swarm-cluster'
export type { SwarmClusterShape } from './cluster/swarm-cluster'
export { makeSwarmFleet, SwarmFleet } from './fleet/swarm-fleet'
export type { SwarmFleetShape } from './fleet/swarm-fleet'
export { SwarmBootstrap } from './bootstrap/swarm-bootstrap'
export type { SwarmBootstrapShape } from './bootstrap/swarm-bootstrap'
export {
    makeSwarmParticipation,
    SwarmParticipation,
} from './participation/swarm-participation'
export type {
    ParticipationError,
    SwarmParticipationShape,
} from './participation/swarm-participation'
export { POLICY_DOCUMENTS } from './participation/policy-documents'
export {
    decideRole,
    DEFAULT_QUORUM_TARGET,
    quorumTarget,
} from './join/join-decision'
export { SwarmJoinGrant } from './join/swarm-join-grant'
export type { SwarmJoinGrantShape } from './join/swarm-join-grant'

export {
    parsePlacementPolicyLabel,
    toSwarmPlacement,
} from './placement/node-placement'
export type {
    PlacementPolicy,
    PlacementPolicyInput,
    SwarmPlacementPlan,
} from './placement/node-placement'

export {
    makeSwarmLeadership,
    MASTER_CHANGED_EVENT,
    SwarmLeadership,
} from './election/swarm-leadership'
export type {
    ClusterMetricsProvider,
    LeadershipEventSink,
    MasterChangedEvent,
    SwarmLeadershipShape,
} from './election/swarm-leadership'
export {
    buildMasterScoreResult,
    DEFAULT_MASTER_SCORER_WEIGHTS,
    isEligibleAsMaster,
    scoreCandidate,
    selectMasterWinner,
} from './election/master-scorer'
export type {
    MasterCandidateMetrics,
    MasterScoreResult,
    MasterScorerWeights,
} from './election/master-scorer'
export { isQuorumIntact, planQuorum } from './election/quorum-planner'
export type { QuorumPlan } from './election/quorum-planner'

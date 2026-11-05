import type { MeshTransportOptions } from '@deployer/nest-mesh'

/**
 * What a service on this node may ask its agent, as `group.key` ids.
 *
 * The service door is an allowlist, not the peer router minus a few: a procedure is reachable from a service container
 * only by being named here. That is the difference F-06 turns on — `roster.credential`, `roster.rotate`,
 * `roster.token`, `roster.join`, `roster.block`/`unblock` and `node.configure` are absent, so a compromised service
 * cannot read the swarm secret, rotate it, join a swarm, issue itself a token, cut a member off or reconfigure the node.
 *
 * The admin door serves everything, so adding a procedure here is a decision about exposure, and the resolver fails the
 * boot if an id here names nothing (`serviceProcedures` typo guard).
 */
export const SERVICE_DOOR_PROCEDURES: NonNullable<
    MeshTransportOptions['serviceProcedures']
> = [
    // What a service asks about the replicas of its peers: announce itself, look one up, see the table.
    'directory.register',
    'directory.unregister',
    'directory.resolve',
    'directory.snapshot',
    // The broker every service-to-service call goes through.
    'relay.call',
    // Whether a caller's credential is this swarm's: no secret is returned.
    'access.verify',
    // The cluster's replicated settings: read them, publish one (the API's `node.doors`), see the roster.
    'roster.check',
    'roster.setting',
    'roster.view',
    // This node's own facts: status, labels, settings, state. Read-only except labels.
    'node.labels',
    'node.settings',
    'node.state',
    'node.status',
]

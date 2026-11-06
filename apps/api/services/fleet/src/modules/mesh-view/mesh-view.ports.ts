import { Context, type Effect } from 'effect'

import type { ClientContext, ClientLink } from '@orpc/client'

/**
 * This node's agent, and what to call a node that has none.
 *
 * The link is looked up on each call, not once at boot: the agent can start after this service, and a node that gains an
 * agent should be seen as having one without a restart. A node without an agent is a swarm of one, known by its own id.
 */
export type MeshAgentShape = {
    readonly link: () => ClientLink<ClientContext> | undefined
    readonly standalone: () => Effect.Effect<{ readonly nodeId: string }>
}

export class MeshAgent extends Context.Service<MeshAgent, MeshAgentShape>()(
    'fleet/MeshAgent'
) {}

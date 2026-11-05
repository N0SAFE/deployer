import { Context } from 'effect'

export type NodeIdentityShape = {
    /** The node this agent runs on. Locality is relative to it. */
    readonly nodeId: string
}

/** Provided by the module from the validated environment, so tests give it a node of their own. */
export class NodeIdentity extends Context.Service<
    NodeIdentity,
    NodeIdentityShape
>()('node-agent/NodeIdentity') {}

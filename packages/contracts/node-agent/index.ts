// Public surface of @deployer/node-agent-contracts.
//
// Owned by the node-agent service. Every procedure is INTERNAL to the platform: the agent serves the mesh router to
// its node and to other agents, and the node router (`node/`) only on its local socket. The BFF never composes it into
// the public router.

export * from './mesh'
export * from './node'

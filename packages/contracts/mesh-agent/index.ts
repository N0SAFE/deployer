// Public surface of @deployer/mesh-agent-contracts.
//
// Owned by the mesh-agent service. Every procedure lives under `mesh/` and is INTERNAL to the platform: the agent
// serves it to the services on its node and to other agents, and the BFF never composes it into the public router.

export * from "./mesh";

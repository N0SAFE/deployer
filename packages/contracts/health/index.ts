// Public surface of @deployer/health-contracts.
//
// Owned by the health service: the service serves these procedures and
// nothing else, so the contract cannot drift from the implementation. The BFF
// composes this into its public router.

export * from "./modules/health";

/**
 * The full API contract, composed from its modules for the setup app's SSR
 * client.
 *
 * the per-service contract packages deliberately do not export a combined
 * router: the inferred type of a 23-module router exceeds TypeScript's
 * declaration serialization limit (TS7056), so it cannot live in a package
 * that emits declarations. Applications compose it locally; setup never emits
 * declarations, so the type is never serialized.
 */

import { oc } from "@orpc/contract";
import { testContract, templateContract, setupAppContract } from "@deployer/bff-contracts";
import { providerSchemaContract, nodesContract, reachabilityContract, providersContract, meshContract, clusterContract, platformContract } from "@deployer/fleet-contracts";
import { healthContract } from "@deployer/health-contracts";
import { userContract, pushContract, analyticsContract } from "@deployer/identity-contracts";
import { domainContract, projectContract, serviceContract, servicePreviewTopologyContract } from "@deployer/project-contracts";
import { deploymentContract, dockerContract } from "@deployer/runtime-contracts";
import { meshBaseResourceContract } from "@deployer/fleet-contracts/modules/mesh/resource/mesh-base-resource.contract";

export const appContract = oc.router({
    user: userContract,
    health: healthContract,
    push: pushContract,
    test: testContract,
    domain: domainContract,
    project: projectContract,
    service: serviceContract,
    servicePreviewTopology: servicePreviewTopologyContract,
    deployment: deploymentContract,
    analytics: analyticsContract,
    providerSchema: providerSchemaContract,
    template: templateContract,
    docker: dockerContract,
    // The contract the SETUP APP implements (a superset of nothing the wizard uses
    // from the API's own `setupContract`): it also carries the setup-only
    // procedures, e.g. `retryHandover`.
    setup: setupAppContract,
    nodes: nodesContract,
    reachability: reachabilityContract,
    providers: providersContract,
    mesh: meshContract,
    platform: platformContract,
    cluster: clusterContract,
    meshResource: meshBaseResourceContract,
});

export type AppContract = typeof appContract;

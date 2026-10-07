/**
 * The full API contract, composed from its modules for the web client.
 *
 * `@repo/api-contracts` deliberately does not export a combined router: the
 * inferred type of a 21-module router exceeds TypeScript's declaration
 * serialization limit (TS7056), so it cannot live in a package that emits
 * declarations. The web app composes it locally and never emits declarations,
 * so the type is never serialized.
 */

import { oc } from "@orpc/contract";
import {
    userContract,
    healthContract,
    pushContract,
    testContract,
    domainContract,
    projectContract,
    serviceContract,
    servicePreviewTopologyContract,
    deploymentContract,
    analyticsContract,
    providerSchemaContract,
    templateContract,
    dockerContract,
    setupContract,
    nodesContract,
    reachabilityContract,
    providersContract,
    meshContract,
    clusterContract,
    platformContract,
} from "@repo/api-contracts";
import { meshBaseResourceContract } from "@repo/api-contracts/modules/mesh/resource/mesh-base-resource.contract";

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
    setup: setupContract,
    nodes: nodesContract,
    reachability: reachabilityContract,
    providers: providersContract,
    mesh: meshContract,
    platform: platformContract,
    cluster: clusterContract,
    meshResource: meshBaseResourceContract,
});

export type AppContract = typeof appContract;

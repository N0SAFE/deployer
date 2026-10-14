/**
 * The full API contract, composed from its modules.
 *
 * `@repo/api-contracts` deliberately does not export a combined router: the
 * inferred type of a 21-module router exceeds TypeScript's declaration
 * serialization limit (TS7056), so it cannot live in a package that emits
 * declarations. Applications compose it locally instead — this file is the
 * single composition point for `apps/api`, and apps never emit declarations,
 * so the type is never serialized.
 *
 * Keep the entry list in sync with `packages/contracts/api/modules/index.ts`.
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
    // Node-scoped surface: fleet servers, per-node allocations, admission.
    nodes: nodesContract,
    reachability: reachabilityContract,
    providers: providersContract,
    // Public mesh surface: info + management endpoints. The mesh-to-mesh
    // transport endpoints (meshInternalContract) are intentionally NOT here —
    // they are only callable inside the mesh.
    mesh: meshContract,
    // API-centric platform surface: web app-instance registration/heartbeat
    // plus operator management of the managed web app.
    platform: platformContract,
    // Swarm cluster surface: snapshot, fleet inventory, master, node labels.
    cluster: clusterContract,
    // The resource-dispatcher catch-all (POST /mesh/:entityKey/:methodName)
    // remains reachable via the MeshResourceController. It is NOT part of the
    // public app contract either — the cross-node caller uses it directly.
    meshResource: meshBaseResourceContract,
});

export type AppContract = typeof appContract;

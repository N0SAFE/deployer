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
    coreContract,
    reachabilityContract,
    providersContract,
    meshContract,
    platformContract,
} from "./modules/index";
import { meshBaseResourceContract } from "./modules/mesh/resource/mesh-base-resource.contract";

// Main app contract that combines all feature contracts
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
    core: coreContract,
    reachability: reachabilityContract,
    providers: providersContract,
    // Public mesh surface: info + management endpoints. The mesh-to-mesh
    // transport endpoints (meshInternalContract) are intentionally NOT here —
    // they are only callable inside the mesh.
    mesh: meshContract,
    // API-centric platform surface: web app-instance registration/heartbeat
    // plus operator management of the managed web app.
    platform: platformContract,
    // The resource-dispatcher catch-all (POST /mesh/:entityKey/:methodName)
    // remains reachable via the MeshResourceController. It is NOT part of the
    // public app contract either — the cross-node caller uses it directly.
    meshResource: meshBaseResourceContract,
});

export type AppContract = typeof appContract;

// Re-export individual contracts and schemas
export * from "./modules/index";
export * from "./types";

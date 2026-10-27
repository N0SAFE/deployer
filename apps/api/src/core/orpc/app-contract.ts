/**
 * The full API contract, composed from its modules.
 *
 * The per-service contract packages deliberately do NOT export a combined
 * router: the inferred type of a 21-module router exceeds TypeScript's
 * declaration serialization limit (TS7056), so it cannot live in a package that
 * emits declarations. Applications compose it locally instead — this file is the
 * single composition point for `apps/api`, and apps never emit declarations,
 * so the type is never serialized.
 *
 * Each entry comes from the contract package that OWNS the domain:
 * `packages/contracts/{bff,health,identity,project,runtime,fleet}`.
 */

import { oc } from "@orpc/contract";
import { testContract, templateContract, setupContract } from "@deployer/bff-contracts";
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

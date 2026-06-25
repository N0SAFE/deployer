import { oc } from "@orpc/contract";
import {
    userContract,
    healthContract,
    pushContract,
    testContract,
    domainContract,
    projectContract,
    serviceContract,
    deploymentContract,
    analyticsContract,
    providerSchemaContract,
    templateContract,
    dockerContract,
    setupContract,
    organizationContract,
    coreContract,
    meshContract,
} from "./modules/index";

// Main app contract that combines all feature contracts
export const appContract = oc.router({
    user: userContract,
    health: healthContract,
    push: pushContract,
    test: testContract,
    domain: domainContract,
    project: projectContract,
    service: serviceContract,
    deployment: deploymentContract,
    analytics: analyticsContract,
    providerSchema: providerSchemaContract,
    template: templateContract,
    docker: dockerContract,
    setup: setupContract,
    core: coreContract,
    organization: organizationContract,
    // Mesh sits at the top level of the router because it owns its own
    // `/mesh` URL prefix. If it were nested (e.g. under `core.mesh.*`)
    // the path would not match the public route used by both clients
    // and the OpenAPI spec — see `SystemMeshController` and the
    // OpenAPILink at `apps/web/src/lib/orpc/links/file-upload-link.ts`.
    mesh: meshContract,
});

export type AppContract = typeof appContract;

// Re-export individual contracts and schemas
export * from "./modules/index";
export * from "./types";

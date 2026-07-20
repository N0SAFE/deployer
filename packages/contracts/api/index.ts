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
});

export type AppContract = typeof appContract;

// Re-export individual contracts and schemas
export * from "./modules/index";
export * from "./types";

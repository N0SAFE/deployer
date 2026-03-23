import { oc } from "@orpc/contract";
import { route } from "@repo/orpc-utils/builder";
import {
    nodeConfigStatusSchema,
    setupConfigureDatabaseInputSchema,
    setupConfigureDatabaseResultSchema,
    setupInitializeInputSchema,
    setupInitializeResultSchema,
    setupStateMachineSchema,
    setupStateSnapshotSchema,
} from "@repo/api-contracts/common/setup";

export const setupGetStatusContract = route({
    method: "GET",
    path: "/status",
    summary: "Get first-setup state-machine snapshot",
})
    .output((b) => b.body(setupStateSnapshotSchema))
    .build();

export const setupGetStateMachineContract = route({
    method: "GET",
    path: "/state-machine",
    summary: "Get first-setup state machine states and transitions",
})
    .output((b) => b.body(setupStateMachineSchema))
    .build();

export const setupInitializeContract = route({
    method: "POST",
    path: "/initialize",
    summary: "Execute first setup flow: create initial admin and organization",
})
    .input((b) => b.body(setupInitializeInputSchema))
    .output((b) => b.body(setupInitializeResultSchema))
    .build();

export const setupConfigureDatabaseContract = route({
    method: "POST",
    path: "/configure-database",
    summary: "Configure global database connection for this node (step 0 of setup)",
})
    .input((b) => b.body(setupConfigureDatabaseInputSchema))
    .output((b) => b.body(setupConfigureDatabaseResultSchema))
    .build();

export const setupGetNodeStatusContract = route({
    method: "GET",
    path: "/node-status",
    summary: "Get node config file status (no DB required)",
})
    .output((b) => b.body(nodeConfigStatusSchema))
    .build();

export const setupContract = oc.tag("Setup").prefix("/setup").router({
    getStatus: setupGetStatusContract,
    getStateMachine: setupGetStateMachineContract,
    initialize: setupInitializeContract,
    configureDatabase: setupConfigureDatabaseContract,
    getNodeStatus: setupGetNodeStatusContract,
});

export type SetupContract = typeof setupContract;
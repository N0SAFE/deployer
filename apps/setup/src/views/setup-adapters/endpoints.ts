"use client";

/**
 * Setup contract endpoints for the API-served views.
 *
 * Thin named accessors over the view ORPC client, so the hooks (and the shared
 * wizard) never index into the contract directly.
 */

import { orpc } from "@/views/lib/orpc";

export const setupEndpoints = {
	getState: orpc.setup.getState,
	getNodeStatus: orpc.setup.getNodeStatus,
	probeDatabase: orpc.setup.probeDatabase,
	probeMesh: orpc.setup.probeMesh,
	remoteAuth: orpc.setup.remoteAuth,
	triggerInitialize: orpc.setup.triggerInitialize,
	getInitializeStream: orpc.setup.getInitializeStream,
	listPostSetupHints: orpc.setup.listPostSetupHints,
	dismissPostSetupHint: orpc.setup.dismissPostSetupHint,
	getPostSetupDestination: orpc.setup.getPostSetupDestination,
} as const;

export type SetupEndpoints = typeof setupEndpoints;

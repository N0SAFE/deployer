"use client";

/**
 * Supplies the shared setup wizard with THIS app's data access.
 *
 * The wizard UI lives in `@deployer/ui` (one implementation, no duplication); what
 * differs per host is how it reaches the platform. The API serves the page, so
 * it talks to its own origin.
 */

import type { SetupWizardApi } from "@deployer/ui/components/setup/types";

import { signInWithEmail } from "@/views/lib/auth";
import { getErrorMessage } from "@/views/lib/errors";
import {
	useInitializeStream,
	usePostSetupDestination,
	usePostSetupVerification,
	retryHandover,
	useProbeDatabase,
	useSetupState,
	useTriggerInitialize,
	useMeshStatus,
	joinMesh,
	issueMeshToken,
} from "@/views/setup-adapters/hooks";
import { resolvePostSetupRedirect } from "@/views/setup-adapters/redirect-target";

export const setupApi: SetupWizardApi = {
	useSetupState,
	useTriggerInitialize,
	useInitializeStream,
	useProbeDatabase,
	signInWithEmail,
	getErrorMessage,
	// The page is served by the API, so provisioning calls target the page's
	// own origin (proxy/tunnel safe).
	apiBaseUrl: () => (typeof window === "undefined" ? "" : window.location.origin),
	usePostSetupDestination,
	usePostSetupVerification,
	retryHandover,
	// Mesh onboarding: setup sits next to the node's agent, so the wizard can
	// show the mesh state and redeem/issue invites before the platform exists.
	useMeshStatus,
	joinMesh,
	issueMeshToken,
	postSetupRedirectUrl: () => resolvePostSetupRedirect(),
};

"use client";

/**
 * Supplies the shared setup wizard with THIS app's data access.
 *
 * The wizard UI lives in `@repo/ui` (one implementation, no duplication); what
 * differs per host is how it reaches the platform. The API serves the page, so
 * it talks to its own origin.
 */

import type { SetupWizardApi } from "@repo/ui/components/setup/types";
import {
	useInitializeStream,
	useProbeDatabase,
	useProbeMesh,
	useRemoteAuth,
	useSetupState,
	useTriggerInitialize,
} from "@/views/setup-adapters/hooks";
import { signInWithEmail } from "@/views/lib/auth";
import { getErrorMessage } from "@/views/lib/errors";
import { resolvePostSetupRedirect } from "@/views/setup-adapters/redirect-target";

export const setupApi: SetupWizardApi = {
	useSetupState,
	useTriggerInitialize,
	useInitializeStream,
	useProbeDatabase,
	useProbeMesh,
	useRemoteAuth,
	signInWithEmail,
	getErrorMessage,
	// The page is served by the API, so provisioning calls target the page's
	// own origin (proxy/tunnel safe).
	apiBaseUrl: () => (typeof window === "undefined" ? "" : window.location.origin),
	postSetupRedirectUrl: () => resolvePostSetupRedirect(),
};

"use client";

/**
 * Supplies the shared setup wizard with the WEB app's data access.
 *
 * The UI lives in `@repo/ui` (one implementation, no duplication); the web app
 * differs from the API only in transport: it must address the API explicitly
 * (its own origin serves the dashboard, not the setup ORPC surface).
 */

import type { SetupWizardApi } from "@repo/ui/components/setup/types";
import {
	useInitializeStream,
	useProbeDatabase,
	useProbeMesh,
	useRemoteAuth,
	useSetupState,
	useTriggerInitialize,
} from "@/domains/setup/hooks";
import { signInWithEmail } from "@/lib/auth";
import { getErrorMessage } from "@/lib/orpc/typed-errors";
import { getBaseApiUrl } from "@/lib/api-url";
import { setupDestinationUrl } from "@/lib/setup-url";

export const setupApi: SetupWizardApi = {
	useSetupState,
	useTriggerInitialize,
	useInitializeStream,
	useProbeDatabase,
	useProbeMesh,
	useRemoteAuth,
	signInWithEmail,
	getErrorMessage,
	// The web app serves the dashboard, so provisioning must address the API
	// origin (the browser-reachable one, not the private network name).
	apiBaseUrl: () => getBaseApiUrl(),
	// This host IS the dashboard, so the destination is the current origin by
	// definition and needs no server round-trip to resolve.
	usePostSetupDestination: () => ({
		data: { kind: "dashboard" as const, url: "/", managedWebEnabled: true },
	}),
	// The dashboard is already here — no cross-origin hand-off needed.
	postSetupRedirectUrl: () => "/",
};

/** Exported for the rare caller that needs the API-served wizard URL. */
export { setupDestinationUrl };

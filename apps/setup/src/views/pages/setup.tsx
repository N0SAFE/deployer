"use client";

import { useEffect } from "react";
import type { PageProps } from "@nestjs-ssr/react";

// ONE wizard implementation, shared by the API and the web app. This page only
// supplies the API's data access (the adapter), never a second copy of the UI.
import { SetupWizard } from "@repo/ui/components/setup/setup-wizard";
import { setupApi } from "@/views/setup-adapters/api";
import { resolvePostSetupRedirect } from "@/views/setup-adapters/redirect-target";

/**
 * The setup page, served by the API itself.
 *
 * WHY IT LIVES HERE: setup is the only phase where no web app is guaranteed to
 * exist — `platform-managed-web` is activated THROUGH setup, so it can never be
 * the surface that runs it. Serving onboarding from the API removes that
 * circular dependency: the API is already listening on the entry port before
 * setup, so the wizard is reachable no matter what the web app is doing.
 *
 * CONSEQUENCE (deliberate): the web app no longer renders `/setup` at all. It
 * only ever shows the dashboard, once setup has activated it. Users are handed
 * over at the final wizard step.
 */
export interface SetupViewProps {
	/** False when setup already completed — the page then hands the operator to
	 *  the web app rather than re-running onboarding. */
	needsSetup: boolean;
}

export default function SetupView({ needsSetup }: PageProps<SetupViewProps>) {
	// Setup already done: this page has nothing to do. Send the operator to the
	// TARGETED web app (the dashboard), not the API's own console — the whole
	// point of the hand-off is that the API surface is not where they work.
	useEffect(() => {
		if (!needsSetup) {
			window.location.assign(resolvePostSetupRedirect());
		}
	}, [needsSetup]);

	if (!needsSetup) {
		return (
			<div className="flex min-h-[60dvh] items-center justify-center">
				<p className="text-sm text-muted-foreground">Setup is complete — opening the dashboard…</p>
			</div>
		);
	}

	return (
		<div className="flex min-h-[80dvh] items-center justify-center py-6">
			<div className="w-full max-w-2xl">
				<SetupWizard api={setupApi} />
			</div>
		</div>
	);
}

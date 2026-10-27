import { Injectable } from "@nestjs/common";

import { platformContract, type ManagedWebState } from "@deployer/fleet-contracts";
import { ServiceClientRegistry } from "../../../clients/service-registry";

/**
 * The managed web app's state and actions, read from the service that owns them.
 *
 * ── WHY A CLIENT AND NOT AN IMPORT ──────────────────────────────────────────
 * The console pages are the BFF's FALLBACK visual for the console URL, rendered when
 * no web app is running. The state they show — enabled, origin, tunnel, health —
 * belongs to fleet's platform domain, across a service boundary. The earlier version
 * imported `PlatformManagedWebService` directly, so the BFF compiled against fleet's
 * internals; that is the coupling the split removes, and the reason this goes through
 * the contract.
 *
 * ── WHY NOTHING HERE IS CACHED ──────────────────────────────────────────────
 * A console page is opened to see the CURRENT state, so caching it would cache the
 * one thing the operator came to check.
 *
 * ── WHY THE MUTATIONS LIVE HERE AND NOT IN THE VIEWS ────────────────────────
 * The views are client components: they hold a React Query hook but they cannot hold
 * a service client, and they must not know which service owns the action. Keeping the
 * calls behind this service is what lets the page stay a page — and what makes the
 * BFF's `console.*` procedures the only surface the browser addresses, instead of the
 * browser reaching a service namespace directly.
 */
@Injectable()
export class ManagedWebClient {
	constructor(private readonly clients: ServiceClientRegistry) {}

	/** The platform client, bound with the caller's credentials by the registry. */
	private get platform() {
		return this.clients.for("fleet", platformContract);
	}

	async state(): Promise<ManagedWebState> {
		return this.platform.getManagedWebState({});
	}

	async toggle() {
		return this.platform.toggleManagedWeb({});
	}

	async restart() {
		return this.platform.restartManagedWeb({});
	}

	async setOrigin(input: { origin: string | null }) {
		return this.platform.setManagedWebOrigin(input);
	}

	async enableTunnel(input: { hostname: string }) {
		return this.platform.enableManagedWebTunnel(input);
	}

	async disableTunnel() {
		return this.platform.disableManagedWebTunnel({});
	}
}

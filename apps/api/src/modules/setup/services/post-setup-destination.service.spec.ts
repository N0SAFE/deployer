import { describe, expect, it, vi } from "vitest";

import { PostSetupDestinationService } from "./post-setup-destination.service";
import type { EnvService } from "@/config/env/env.module";
import type { HostnameService } from "@/core/modules/platform-ingress/services/hostname.service";
import type { PlatformConfigService } from "@/core/modules/platform-ingress/services/platform-config.service";

/**
 * The destination the wizard's final click uses.
 *
 * This replaced a CLIENT-side guess (`window.location`), which sent operators to
 * `web.<host>` on an "API only" install — a hostname with no router, so a 404 on
 * the last click of a successful setup. The two cases below are the contract.
 */
function makeService(options: {
	enabled?: boolean;
	enabledThrows?: boolean;
	origin?: string | null;
}) {
	const isManagedWebAppEnabled = vi.fn(async () => {
		if (options.enabledThrows === true) throw new Error("relation does not exist");
		return options.enabled ?? false;
	});
	const getManagedWebOrigin = vi.fn(async () => options.origin ?? null);

	const service = new PostSetupDestinationService(
		{ get: vi.fn() } as unknown as EnvService,
		{
			webOrigin: () => "http://web.deployer.localhost",
			apiOrigin: () => "http://api.deployer.localhost",
		} as unknown as HostnameService,
		{ isManagedWebAppEnabled, getManagedWebOrigin } as unknown as PlatformConfigService,
	);
	return { service, isManagedWebAppEnabled, getManagedWebOrigin };
}

describe("PostSetupDestinationService", () => {
	it("sends the operator to the dashboard when it is enabled", async () => {
		const { service } = makeService({ enabled: true });

		const result = await service.resolve();

		expect(result.kind).toBe("dashboard");
		expect(result.url).toBe("http://web.deployer.localhost");
		expect(result.managedWebEnabled).toBe(true);
	});

	it("prefers an explicit operator origin over the derived hostname", async () => {
		// The ingress publishes the web router for this origin too, so the URL and
		// the route cannot disagree — which is why it wins here as well.
		const { service } = makeService({ enabled: true, origin: "app.example.com" });

		expect((await service.resolve()).url).toBe("http://app.example.com");
	});

	it("sends the operator to the API console when no dashboard is enabled", async () => {
		const { service } = makeService({ enabled: false });

		const result = await service.resolve();

		// The API's own page — it cannot 404 the way an unrouted web host would,
		// and it is where a dashboard can be turned on.
		expect(result.kind).toBe("api-console");
		expect(result.url).toBe("http://api.deployer.localhost/manage/web-app");
		expect(result.managedWebEnabled).toBe(false);
	});

	it("falls back to the API console when the flag cannot be read", async () => {
		// The flag lives in a table setup provisions, so a read can legitimately
		// fail. The operator must still have somewhere to go, and the console is
		// the answer that also lets them enable a dashboard.
		const { service } = makeService({ enabledThrows: true });

		const result = await service.resolve();

		expect(result.kind).toBe("api-console");
		expect(result.managedWebEnabled).toBe(false);
	});

	it("adds a scheme to a stored bare host", async () => {
		// `getManagedWebOrigin` stores hosts without a scheme (it normalizes them
		// away), so navigating to it verbatim would be a relative URL.
		const { service } = makeService({ enabled: true, origin: "app.example.com" });

		expect((await service.resolve()).url).toMatch(/^http:\/\//);
	});
});

import { describe, expect, it, vi } from "vitest";
import type { DockerService } from "@repo/nest-docker/services/docker.service";

import { ManagedWebSupervisorService } from "./managed-web-supervisor.service";
import type { EnvService } from "@/config/env/env.module";
import type { HostnameService } from "../../platform-ingress/services/hostname.service";
import type { PlatformConfigService } from "../../platform-ingress/services/platform-config.service";
import type { AppInstanceService } from "../../platform-ingress/services/app-instance.service";

/**
 * The web app distinguishes two API variables, and swapping them breaks every
 * SERVER-side call while leaving the browser working — which is exactly the kind
 * of bug that survives a manual click-through:
 *
 *   NEXT_PUBLIC_API_URL  BROWSER  the public endpoint the operator reaches
 *   API_URL              SERVER   the private Docker-network endpoint
 *
 * `API_URL` was set to the PUBLIC origin, so the managed web's server-side calls
 * failed: the public hostname does not resolve inside a container at all.
 * Measured on a live managed web task:
 *
 *   getent hosts api.deployer.localhost   -> (nothing)
 *   getent hosts deployer-api             -> 10.0.1.4
 *
 * The visible symptom was the web app's own health route reporting
 * `api: unavailable / Unable to connect` and answering 503 on a stack whose API
 * was perfectly reachable on the overlay.
 */
function makeSupervisor(overrides: Record<string, unknown> = {}) {
	const values: Record<string, unknown> = {
		DEPLOYER_PREFIX: "",
		API_PORT: 3005,
		DEPLOYER_TRAEFIK_IMAGE: "traefik:v3.6.10",
		DEPLOYER_TRAEFIK_HTTP_PORT: 80,
		AUTH_SECRET: "a-shared-secret",
		...overrides,
	};
	const env = { get: vi.fn((key: string) => values[key]) } as unknown as EnvService;

	const hostnameService = {
		apiOrigin: () => "http://api.deployer.localhost",
		webOrigin: () => "http://web.deployer.localhost",
		webHostname: () => "web.deployer.localhost",
	} as unknown as HostnameService;

	const platformConfig = {
		isManagedWebAppEnabled: vi.fn(async () => true),
	} as unknown as PlatformConfigService;

	const appInstances = {
		create: vi.fn(async () => ({ appToken: "a-minted-token" })),
	} as unknown as AppInstanceService;

	const docker = {
		getDockerClient: () => ({}),
	} as unknown as DockerService;

	const supervisor = new ManagedWebSupervisorService(
		docker,
		hostnameService,
		env,
		platformConfig,
		appInstances,
	);

	// `managedWebEnv` is the unit under test; reach it without booting the
	// supervisor's lifecycle.
	const env2 = (
		supervisor as unknown as { managedWebEnv(): Promise<string[]> }
	).managedWebEnv.bind(supervisor);

	return { env2, hostnameService };
}

describe("ManagedWebSupervisorService.managedWebEnv", () => {
	it("gives the SERVER the private network address, not the public one", async () => {
		const { env2 } = makeSupervisor();

		const env = await env2();

		// The whole point: server-side calls must dial something that resolves on
		// the overlay.
		expect(env).toContain("API_URL=http://deployer-api:3005");
		expect(env).not.toContain("API_URL=http://api.deployer.localhost");
	});

	it("gives the BROWSER the public origin", async () => {
		const { env2 } = await makeSupervisor();

		const env = await env2();

		// The browser cannot reach the overlay, so it must get the public host.
		expect(env).toContain("NEXT_PUBLIC_API_URL=http://api.deployer.localhost");
		expect(env).toContain("NEXT_PUBLIC_APP_URL=http://web.deployer.localhost");
	});

	it("derives the private address from the prefix", async () => {
		const { env2 } = makeSupervisor({ DEPLOYER_PREFIX: "acme" });

		const env = await env2();

		expect(env).toContain("API_URL=http://deployer-api-acme:3005");
	});

	it("still forwards the shared auth secret to both keys", async () => {
		const { env2 } = makeSupervisor();

		const env = await env2();

		// The web schema refuses to boot when these differ.
		expect(env).toContain("AUTH_SECRET=a-shared-secret");
		expect(env).toContain("BETTER_AUTH_SECRET=a-shared-secret");
	});
});

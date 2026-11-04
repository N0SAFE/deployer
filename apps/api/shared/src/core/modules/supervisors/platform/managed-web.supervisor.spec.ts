import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { DockerEngineShape } from "@deployer/docker";

import { harness, testBus } from "../supervisor-test-harness";

import { makeManagedWebRegistration } from "./managed-web.supervisor";

import type { EnvService } from "../../../../config/env/env.module";
import type { AppInstanceServiceShape } from "../../platform-ingress/services/app-instance.service";
import type { HostnameService } from "../../platform-ingress/services/hostname.service";
import type { PlatformConfigServiceShape } from "../../platform-ingress/services/platform-config.service";

/**
 * The host's job is wiring: the environment, hostnames, platform flag and app-instance service reach
 * the Effect supervisor. The supervisor's own behaviour is tested in `@deployer/platform-supervisors`.
 */
function makeSupervisor(options: { flag?: boolean; prefix?: string; managed?: { id: string } | null } = {}) {
	const values: Record<string, unknown> = { DEPLOYER_PREFIX: options.prefix ?? "", API_PORT: 3005, AUTH_SECRET: "a-shared-secret" };
	const env = { get: vi.fn((key: string) => values[key]) } as unknown as EnvService;
	const hostnames = {
		apiOrigin: () => "http://api.deployer.localhost",
		webOrigin: () => "http://web.deployer.localhost",
		webHostname: () => "web.deployer.localhost",
	} as unknown as HostnameService;
	const platformConfig = { isManagedWebAppEnabled: vi.fn(() => Effect.succeed(options.flag ?? true)) } as unknown as PlatformConfigServiceShape;
	const appInstances = {
		create: vi.fn(() => Effect.succeed({ instanceId: "inst-1", appToken: "a-minted-token" })),
		findManaged: vi.fn(() => Effect.succeed(options.managed ?? null)),
		revoke: vi.fn(() => Effect.succeed(true)),
	};

	const reconciled: { name: string; env: string[] }[] = [];
	const removed: string[] = [];
	const engine = {
		swarmCluster: { isActive: () => Effect.succeed(true) },
		networks: { ensureOverlay: () => Effect.void },
		swarmServices: {
			reconcile: (spec: { name: string; env: string[] }) => Effect.sync(() => { reconciled.push(spec); }),
			inspect: (name: string) => Effect.succeed({ ID: "svc-1", CreatedAt: "", UpdatedAt: "", Spec: { Name: name } }),
			listTasks: () => Effect.succeed([]),
			remove: (name: string) => Effect.sync(() => { removed.push(name); }),
		},
	};
	const supervisor = harness(
		makeManagedWebRegistration({
			engine: engine as unknown as DockerEngineShape,
			hostnameService: hostnames,
			env,
			platformConfig,
			appInstances: appInstances as unknown as AppInstanceServiceShape,
			bus: testBus(),
		}),
	);
	return { supervisor, reconciled, removed, appInstances };
}

describe("managed web supervisor registration", () => {
	it("runs the console with the platform's own values and a token from the app-instance service", async () => {
		const { supervisor, reconciled, appInstances } = makeSupervisor({ prefix: "acme" });
		expect(await supervisor.ensureDesiredState()).toBe("converged");
		expect(reconciled[0]?.name).toBe("deployer-managed-web-acme");
		expect(reconciled[0]?.env).toEqual(
			expect.arrayContaining(["API_URL=http://deployer-api-acme:3005", "AUTH_SECRET=a-shared-secret", "APP_INSTANCE_TOKEN=a-minted-token"]),
		);
		expect(appInstances.create).toHaveBeenCalledWith({ label: "managed-web-acme", kind: "managed" });
	});

	it("tears down and revokes the managed instance when the flag is off", async () => {
		const { supervisor, removed, appInstances } = makeSupervisor({ flag: false, managed: { id: "inst-9" } });
		await supervisor.ensureDesiredState();
		expect(removed).toEqual(["deployer-managed-web"]);
		expect(appInstances.revoke).toHaveBeenCalledWith("inst-9");
	});

	it("revokes nothing when there is no managed instance", async () => {
		const { supervisor, appInstances } = makeSupervisor({ flag: false, managed: null });
		await supervisor.ensureDesiredState();
		expect(appInstances.revoke).not.toHaveBeenCalled();
	});
});

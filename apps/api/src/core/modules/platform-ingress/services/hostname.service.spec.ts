import { describe, expect, it, vi } from "vitest";
import { EnvHostnameService } from "./hostname.service";
import type { EnvService } from "@/config/env/env.service";

function makeEnv(prefix: string): EnvService {
	return { get: () => prefix } as unknown as EnvService;
}

describe("EnvHostnameService", () => {
	it("omits the prefix segment when DEPLOYER_PREFIX is empty", () => {
		const svc = new EnvHostnameService(makeEnv(""));
		expect(svc.apiHostname()).toBe("api.deployer.localhost");
		expect(svc.webHostname()).toBe("web.deployer.localhost");
	});

	it("inserts the prefix segment when DEPLOYER_PREFIX is set", () => {
		const svc = new EnvHostnameService(makeEnv("acme"));
		expect(svc.apiHostname()).toBe("api.acme.deployer.localhost");
		expect(svc.webHostname()).toBe("web.acme.deployer.localhost");
	});

	it("builds http origins by default", () => {
		const svc = new EnvHostnameService(makeEnv(""));
		expect(svc.apiOrigin()).toBe("http://api.deployer.localhost");
		expect(svc.webOrigin()).toBe("http://web.deployer.localhost");
	});

	it("builds https origins on request", () => {
		const svc = new EnvHostnameService(makeEnv("corp"));
		expect(svc.apiOrigin("https")).toBe("https://api.corp.deployer.localhost");
	});
});

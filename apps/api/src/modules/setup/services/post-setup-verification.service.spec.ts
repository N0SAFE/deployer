import { describe, expect, it, vi } from "vitest";

import type { EnvService } from "@/config/env/env.module";
import type { HostnameService } from "@/core/modules/platform-ingress/services/hostname.service";
import type { PlatformConfigService } from "@/core/modules/platform-ingress/services/platform-config.service";

import { classifyIngressAnswer, PostSetupVerificationService, type IngressTransport } from "./post-setup-verification.service";

/**
 * The wizard's last step trusts these verdicts to unlock "Continue", so the cases
 * that matter are the ones that used to look like success: an ingress that is up
 * but has not published a route yet, and a route whose backend is failing.
 */
describe("classifyIngressAnswer", () => {
	it("treats Traefik's plain-text 404 as 'no route yet', not as a routed answer", () => {
		expect(classifyIngressAnswer({ status: 404, contentType: "text/plain; charset=utf-8" })).toMatchObject({ ok: false, status: 404 });
	});

	it("treats an application's own 404 as proof the route exists", () => {
		expect(classifyIngressAnswer({ status: 404, contentType: "text/html" }).ok).toBe(true);
		expect(classifyIngressAnswer({ status: 401, contentType: "application/json" }).ok).toBe(true);
	});

	it("fails a route whose backend answers 5xx", () => {
		const verdict = classifyIngressAnswer({ status: 502, contentType: "text/plain" });
		expect(verdict.ok).toBe(false);
		expect(verdict.detail).toContain("502");
	});
});

function make(options: { webEnabled: boolean; webOrigin?: string | null; transport: IngressTransport }) {
	const env = {
		get: vi.fn((key: string) => ({ DEPLOYER_PREFIX: "", MANAGED_TRAEFIK_HOST: "traefik", MANAGED_TRAEFIK_HTTP_PORT: 80 })[key]),
	} as unknown as EnvService;
	const hostnames = {
		apiHostname: () => "api.deployer.localhost",
		webHostname: () => "web.deployer.localhost",
		apiOrigin: () => "http://api.deployer.localhost",
		webOrigin: () => "http://web.deployer.localhost",
	} as unknown as HostnameService;
	const config = {
		isManagedWebAppEnabled: vi.fn(() => Promise.resolve(options.webEnabled)),
		getManagedWebOrigin: vi.fn(() => Promise.resolve(options.webOrigin ?? null)),
	} as unknown as PlatformConfigService;
	const service = new PostSetupVerificationService(env, hostnames, config);
	service.transport = options.transport;
	return service;
}

const routed: IngressTransport = () => Promise.resolve({ status: 200, contentType: "application/json" });

describe("PostSetupVerificationService", () => {
	it("verifies the API and the dashboard through the ingress with the browser's Host header", async () => {
		const transport = vi.fn(routed);
		const result = await make({ webEnabled: true, transport }).verify();
		const hosts = transport.mock.calls.map(([request]) => request.host);
		expect(hosts).toEqual(expect.arrayContaining(["api.deployer.localhost", "web.deployer.localhost"]));
		expect(result.targets.map((t) => [t.id, t.routed.ok])).toEqual([["api", true], ["web", true]]);
		expect(result.targets[0]?.probeUrl).toBe("http://api.deployer.localhost/health");
		expect(result.targets[1]?.probeUrl).toBe("http://web.deployer.localhost");
	});

	it("does not fail an API-only install for a dashboard it never asked for", async () => {
		const transport = vi.fn(routed);
		const result = await make({ webEnabled: false, transport }).verify();
		const web = result.targets.find((t) => t.id === "web");
		expect(web).toMatchObject({ expected: false, probeUrl: null, routed: { ok: true } });
		expect(transport.mock.calls.every(([request]) => request.host !== "web.deployer.localhost")).toBe(true);
	});

	it("prefers an operator-set dashboard origin for the browser probe", async () => {
		const result = await make({ webEnabled: true, webOrigin: "apps.example.com", transport: routed }).verify();
		expect(result.targets.find((t) => t.id === "web")?.probeUrl).toBe("http://apps.example.com");
	});

	it("reports an unreachable ingress as a failed answer, never as an exception", async () => {
		const down: IngressTransport = () => Promise.reject(new Error("ECONNREFUSED"));
		const result = await make({ webEnabled: true, transport: down }).verify();
		expect(result.targets.every((t) => !t.routed.ok)).toBe(true);
		expect(result.targets[0]?.routed.detail).toContain("ECONNREFUSED");
	});

	it("keeps 'no route yet' over a later 'connection refused' — it says what to wait for", async () => {
		const calls: string[] = [];
		const mixed: IngressTransport = ({ address }) => {
			calls.push(address);
			return address === "deployer-traefik"
				? Promise.resolve({ status: 404, contentType: "text/plain" })
				: Promise.reject(new Error("ECONNREFUSED"));
		};
		const result = await make({ webEnabled: false, transport: mixed }).verify();
		expect(result.targets[0]?.routed.detail).toContain("no route");
		expect(calls).toContain("traefik");
	});

	it("passes when ANY ingress address routes", async () => {
		const second: IngressTransport = ({ address }) =>
			address === "deployer-traefik" ? Promise.reject(new Error("ENOTFOUND")) : Promise.resolve({ status: 200, contentType: "text/html" });
		const result = await make({ webEnabled: false, transport: second }).verify();
		expect(result.targets[0]?.routed.ok).toBe(true);
	});
});

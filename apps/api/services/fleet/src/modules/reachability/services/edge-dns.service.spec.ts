import { describe, expect, it, vi } from "vitest";
import { defaultIngressLanes, type IngressLanes } from "@deployer/contracts-entities/entities/ingress/index";

import type { DnsProviderRegistryService } from "@/modules/providers/dns/shared/dns-provider-registry.service";
import type { DnsProviderRecord } from "@/modules/providers/dns/shared/dns-provider.interface";

import { EdgeDnsService } from "./edge-dns.service";
import { isPubliclyResolvable, planLaneDnsRecords } from "./lane-dns-plan";

const tunnelRecord = { name: "*.apps.example.com", type: "CNAME" as const, contents: ["tun-1.cfargotunnel.com"], proxied: true, preferredAccountId: "acc-1" };
const meshAddresses = ["100.88.0.2", "100.88.0.1"];

describe("planLaneDnsRecords", () => {
	it("plans nothing for a local-only install — *.localhost needs no DNS", () => {
		expect(planLaneDnsRecords(defaultIngressLanes(), { publicEdgeRecords: [], meshAddresses })).toEqual([]);
	});

	it("takes the public lane's records from its edge provider, tagged with the lane", () => {
		expect(planLaneDnsRecords(defaultIngressLanes(), { publicEdgeRecords: [tunnelRecord], meshAddresses })).toEqual([
			{ ...tunnelRecord, lane: "public" },
		]);
	});

	it("points a publicly resolvable private wildcard at every mesh address", () => {
		const lanes: IngressLanes = { ...defaultIngressLanes(), private: { enabled: true, domain: "mesh.example.com", exposeOnLan: false } };
		expect(planLaneDnsRecords(lanes, { publicEdgeRecords: [], meshAddresses })).toEqual([
			{ lane: "private", name: "*.mesh.example.com", type: "A", contents: ["100.88.0.1", "100.88.0.2"], proxied: false, preferredAccountId: null },
		]);
	});

	it("never plans a private domain no public provider can serve", () => {
		const lanes: IngressLanes = { ...defaultIngressLanes(), private: { enabled: true, domain: "deployer.internal", exposeOnLan: false } };
		expect(planLaneDnsRecords(lanes, { publicEdgeRecords: [], meshAddresses })).toEqual([]);
		expect(isPubliclyResolvable("deployer.internal")).toBe(false);
		expect(isPubliclyResolvable("mesh.example.com")).toBe(true);
	});
});

function registry(records: DnsProviderRecord[], zoneFor: string | null = "example.com") {
	const created: unknown[] = [];
	const deleted: string[] = [];
	const service = {
		listProviderTypes: () => ["cloudflare"],
		listAccounts: vi.fn(() => Promise.resolve([{ providerId: "p1", providerType: "cloudflare" }])),
		findZoneForHostname: vi.fn(() => Promise.resolve(zoneFor === null ? null : { zoneId: "z1", zoneName: zoneFor })),
		listRecords: vi.fn(() => Promise.resolve(records)),
		createRecord: vi.fn((_account: unknown, input: unknown) => {
			created.push(input);
			return Promise.resolve({} as DnsProviderRecord);
		}),
		deleteRecord: vi.fn((_account: unknown, _zone: string, id: string) => {
			deleted.push(id);
			return Promise.resolve();
		}),
	} as unknown as DnsProviderRegistryService;
	return { service, created, deleted };
}

const record = (id: string, type: string, content: string, proxied = false): DnsProviderRecord => ({
	id,
	zoneId: "z1",
	name: "*.apps.example.com",
	type,
	content,
	ttl: 1,
	proxied,
});

describe("EdgeDnsService", () => {
	const plan = { lane: "public" as const, name: "*.apps.example.com", type: "A" as const, contents: ["1.1.1.1", "2.2.2.2"], proxied: false, preferredAccountId: null };

	it("converges the record set to exactly the planned contents", async () => {
		const { service, created, deleted } = registry([record("keep", "A", "1.1.1.1"), record("stale", "A", "9.9.9.9"), record("old-cname", "CNAME", "x.cfargotunnel.com", true)]);
		const [result] = await new EdgeDnsService(service).reconcile([plan]);
		expect(result?.status).toBe("synced");
		expect(deleted.sort()).toEqual(["old-cname", "stale"]);
		expect(created).toEqual([{ zoneId: "z1", type: "A", name: "*.apps.example.com", content: "2.2.2.2", ttl: 1, proxied: false }]);
	});

	it("reports `manual` with the exact record when no provider owns the zone", async () => {
		const { service } = registry([], null);
		const [result] = await new EdgeDnsService(service).reconcile([plan]);
		expect(result).toMatchObject({ status: "manual" });
		expect(result?.detail).toContain("A *.apps.example.com → 1.1.1.1, 2.2.2.2");
	});

	it("reports provider failures per record instead of throwing", async () => {
		const { service } = registry([]);
		(service.listRecords as unknown as { mockRejectedValueOnce(e: Error): void }).mockRejectedValueOnce(new Error("rate limited"));
		const dns = new EdgeDnsService(service);
		const [result] = await dns.reconcile([plan]);
		expect(result).toMatchObject({ status: "error", detail: "rate limited" });
		expect(dns.results()).toEqual([result]);
	});
});

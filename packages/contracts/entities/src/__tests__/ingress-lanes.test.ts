import { describe, expect, it } from "vitest";

import type { EdgeProviderDescriptor } from "../entities/ingress/edge-providers.schema";
import { defaultIngressLanes, enabledLanes, ingressExposure, ingressLanesSchema, lanesForVisibility } from "../entities/ingress/lanes.schema";

function descriptor(overrides: Partial<EdgeProviderDescriptor>): EdgeProviderDescriptor {
	return {
		id: "x-edge",
		label: "X",
		kind: "tunnel",
		summary: "",
		description: "",
		opensInboundPorts: false,
		usesProviderAccount: false,
		servesHttps: true,
		options: [],
		...overrides,
	};
}

const publicLane = { provider: "x-edge", domain: "apps.example.com", acknowledgedInboundPorts: false, options: {} };

describe("ingress lanes", () => {
	it("a fresh install is local only and reachable from nowhere else", () => {
		const lanes = defaultIngressLanes();
		expect(enabledLanes(lanes)).toEqual(["local"]);
		expect(ingressExposure(lanes, null)).toEqual({
			reachableOffMachine: false,
			reachableFromInternet: false,
			opensInboundPorts: false,
			usesProviderAccount: false,
			reachableOnLan: false,
		});
	});

	it("private routes never ride the public lane", () => {
		const lanes = { ...defaultIngressLanes(), private: { enabled: true, domain: "deployer.internal", exposeOnLan: false }, public: publicLane };
		expect(lanesForVisibility("private", lanes)).toEqual(["local", "private"]);
		expect(lanesForVisibility("public", lanes)).toEqual(["local", "private", "public"]);
	});

	it("takes inbound ports and accounts from the edge provider, not from the lane", () => {
		const lanes = { ...defaultIngressLanes(), public: publicLane };
		expect(ingressExposure(lanes, descriptor({ opensInboundPorts: true })).opensInboundPorts).toBe(true);
		expect(ingressExposure(lanes, descriptor({ usesProviderAccount: true })).usesProviderAccount).toBe(true);
		// An unregistered provider claims nothing it cannot back.
		expect(ingressExposure(lanes, null)).toMatchObject({ reachableFromInternet: true, opensInboundPorts: false });
	});

	it("accepts any registered-looking provider id and rejects garbage", () => {
		expect(ingressLanesSchema.safeParse({ ...defaultIngressLanes(), public: publicLane }).success).toBe(true);
		expect(ingressLanesSchema.safeParse({ ...defaultIngressLanes(), public: { ...publicLane, provider: "Bad Id" } }).success).toBe(false);
	});
});

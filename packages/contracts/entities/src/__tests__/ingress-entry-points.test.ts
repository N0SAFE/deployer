import { describe, expect, it } from "vitest";

import { joinEntryPoints, type PublicJoinPath } from "../entities/ingress/entry-points.schema";
import { defaultIngressLanes, type IngressLanes } from "../entities/ingress/lanes.schema";

/**
 * These cover the question the Network pages ask: can a node that is NOT a member
 * reach this cluster at all, and by what route?
 *
 * The failure mode worth guarding is the optimistic one — claiming a route exists
 * when nothing is configured to serve it, which sends an operator to a joiner that
 * can never connect.
 */

function lanes(overrides: Partial<IngressLanes> = {}): IngressLanes {
	return { ...defaultIngressLanes(), ...overrides };
}

const publicLane = { provider: "some-tunnel", domain: "apps.example.com", acknowledgedInboundPorts: false, options: {} };
const lanOpen = { enabled: true, domain: "deployer.internal", exposeOnLan: true };

function path(overrides: Partial<PublicJoinPath> = {}): PublicJoinPath {
	return {
		via: "Some Tunnel",
		available: true,
		target: "https://api.apps.example.com",
		hostHeader: null,
		sources: 2,
		detail: "dial the public domain",
		...overrides,
	};
}

describe("joinEntryPoints", () => {
	it("offers nothing on a lone node — there is no cluster to join yet", () => {
		const summary = joinEntryPoints({ lanes: lanes(), memberCount: 0, publicPath: null });
		expect(summary.joinable).toBe(false);
		expect(summary.preferred).toBe(null);
		expect(summary.points.every((point) => !point.available)).toBe(true);
		expect(summary.points[0]?.detail).toMatch(/no members yet/i);
	});

	it("offers nothing when a node exists but no lane does — the LAN door is opt-in", () => {
		const summary = joinEntryPoints({ lanes: lanes(), memberCount: 1, publicPath: null });
		expect(summary.joinable).toBe(false);
		expect(summary.points.find((point) => point.kind === "lan")?.detail).toMatch(/private lane is off/i);
		expect(summary.points.find((point) => point.kind === "public")?.detail).toMatch(/no public lane/i);
	});

	it("offers LAN once the private lane allows same-network joins", () => {
		const summary = joinEntryPoints({ lanes: lanes({ private: lanOpen }), memberCount: 2, publicPath: null });
		expect(summary.joinable).toBe(true);
		expect(summary.preferred).toBe("lan");
		expect(summary.points.find((point) => point.kind === "lan")?.sources).toBe(2);
	});

	it("requires the lane hostname as a Host header when the target is a bare address", () => {
		const summary = joinEntryPoints({ lanes: lanes({ private: lanOpen }), memberCount: 1, publicPath: null });
		// Traefik matches on `Host(...)`, so dialing the address without the name it
		// built the router for reaches the door and 404s. The entry point has to say so.
		expect(summary.points.find((point) => point.kind === "lan")?.hostHeader).toBe("api.deployer.internal");
	});

	it("does not offer LAN when the private lane binds the mesh address only", () => {
		const summary = joinEntryPoints({
			lanes: lanes({ private: { ...lanOpen, exposeOnLan: false } }),
			memberCount: 1,
			publicPath: null,
		});
		const lan = summary.points.find((point) => point.kind === "lan");
		expect(lan?.available).toBe(false);
		expect(lan?.detail).toMatch(/not yet a member/i);
	});

	it("reports the public path exactly as the edge provider describes it", () => {
		const summary = joinEntryPoints({ lanes: lanes({ public: publicLane }), memberCount: 1, publicPath: path() });
		const pub = summary.points.find((point) => point.kind === "public");
		expect(pub).toMatchObject({ via: "Some Tunnel", available: true, target: "https://api.apps.example.com", sources: 2 });
		expect(summary.preferred).toBe("public");
	});

	it("keeps the public path unavailable when its provider says so", () => {
		const summary = joinEntryPoints({
			lanes: lanes({ public: publicLane }),
			memberCount: 1,
			publicPath: path({ available: false, detail: "not provisioned" }),
		});
		expect(summary.joinable).toBe(false);
		expect(summary.points.find((point) => point.kind === "public")?.detail).toBe("not provisioned");
	});

	it("prefers the least-exposure route when several are available", () => {
		const summary = joinEntryPoints({
			lanes: lanes({ private: lanOpen, public: publicLane }),
			memberCount: 3,
			publicPath: path(),
		});
		expect(summary.preferred).toBe("lan");
		expect(summary.points.filter((point) => point.available)).toHaveLength(2);
	});

	it("never offers a route on an empty cluster, whatever the provider claims", () => {
		const summary = joinEntryPoints({ lanes: lanes({ public: publicLane }), memberCount: 0, publicPath: path() });
		expect(summary.joinable).toBe(false);
		expect(summary.points.map((point) => point.available)).toEqual([false, false]);
	});

	it("always lists both routes in canonical order, available or not", () => {
		const summary = joinEntryPoints({ lanes: lanes(), memberCount: 0, publicPath: null });
		expect(summary.points.map((point) => point.kind)).toEqual(["lan", "public"]);
	});
});

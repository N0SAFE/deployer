import { afterEach, describe, expect, it } from "vitest";

import {
	clearRoleSnapshot,
	installRoleSnapshot,
	roleHasPermission,
	roleSnapshotEpoch,
} from "./role-catalog";

describe("role catalogue snapshot", () => {
	afterEach(() => {
		clearRoleSnapshot();
	});

	it("falls back to the declared catalogue before any snapshot exists", () => {
		expect(roleSnapshotEpoch()).toBeNull();
		// `superAdmin` is the danger bundle in the declaration; the fallback must agree with it.
		expect(roleHasPermission("superAdmin", "user:delete")).toBe(true);
		expect(roleHasPermission("user", "user:delete")).toBe(false);
	});

	it("lets the DATABASE answer once a snapshot is installed: a revoked permission is gone", () => {
		// The rows say superAdmin no longer deletes users — the snapshot, not the code table, decides.
		installRoleSnapshot(7, [{ name: "superAdmin", permissions: ["user:list"] }]);

		expect(roleSnapshotEpoch()).toBe(7);
		expect(roleHasPermission("superAdmin", "user:delete")).toBe(false);
		expect(roleHasPermission("superAdmin", "user:list")).toBe(true);
	});

	it("treats an EMPTY catalogue as 'not ready' and falls back, so boot does not deny everybody", () => {
		installRoleSnapshot(1, []);

		expect(roleHasPermission("superAdmin", "user:delete")).toBe(true);
	});

	it("grants nothing to a role the catalogue does not list", () => {
		installRoleSnapshot(8, [{ name: "auditor", permissions: ["audit:read"] }]);

		// A role deleted while accounts still carry its name fails closed, never open.
		expect(roleHasPermission("deleted-role", "audit:read")).toBe(false);
		expect(roleHasPermission(null, "audit:read")).toBe(false);
	});
});

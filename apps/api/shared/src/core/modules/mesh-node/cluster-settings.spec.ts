import { describe, expect, it, vi } from "vitest";
import z from "zod/v4";

import type { NodeDoorClient, NodeDoorSetting } from "@deployer/mesh-client";

import { ClusterSettings } from "./cluster-settings";

/**
 * The real door JSON-encodes on write and hands back the stored strings; the fake does the same so the
 * tests assert the format the agent actually keeps.
 */
function fakeDoor(stored: readonly NodeDoorSetting[] | null) {
	const writes: NodeDoorSetting[] = [];
	const door: NodeDoorClient = {
		status: () => Promise.resolve(null),
		settings: vi.fn(() => Promise.resolve(stored)),
		view: () => Promise.resolve(null),
		writeSetting: vi.fn((key: string, value: unknown) => {
			const written = { key, value: JSON.stringify(value), updatedAt: 1 };
			writes.push(written);
			return Promise.resolve(written);
		}),
		issueJoinToken: () => Promise.resolve(null),
		joinWithToken: () => Promise.resolve(null),
		checkJoinToken: () => Promise.resolve(null),
  labels: () => Promise.resolve(null),
  blockNode: () => Promise.resolve(null),
  unblockNode: () => Promise.resolve(null),
	};
	return { door, writes };
}

const setting = (key: string, value: unknown): NodeDoorSetting => ({ key, value: JSON.stringify(value), updatedAt: 1 });
const portSchema = z.object({ port: z.number() });

describe("ClusterSettings", () => {
	it("decodes every setting the agent holds", async () => {
		const { door } = fakeDoor([setting("ingress.lanes", { entryPort: 80 }), setting("node.doors", { entryPort: 80 })]);
		expect(await new ClusterSettings(door).readAll()).toEqual({ "ingress.lanes": { entryPort: 80 }, "node.doors": { entryPort: 80 } });
	});

	it("skips a malformed value instead of taking a plane down", async () => {
		const { door } = fakeDoor([{ key: "broken", value: "{not json", updatedAt: 1 }, setting("ok", { port: 80 })]);
		expect(await new ClusterSettings(door).readAll()).toEqual({ ok: { port: 80 } });
	});

	it("answers the caller's default when there is no agent, so no plane fails", async () => {
		const { door } = fakeDoor(null);
		const settings = new ClusterSettings(door);
		expect(await settings.read("k", portSchema, { port: 1 })).toEqual({ port: 1 });
		expect(await settings.available()).toBe(false);
	});

	it("reads nothing as the default when the key is unset", async () => {
		const { door } = fakeDoor([]);
		expect(await new ClusterSettings(door).read("k", portSchema, null)).toBeNull();
		expect(await new ClusterSettings(door).available()).toBe(true);
	});

	it("validates through the schema when one is given", async () => {
		const { door } = fakeDoor([setting("k", { port: "eighty" })]);
		expect(await new ClusterSettings(door).read("k", portSchema, { port: 1 })).toEqual({ port: 1 });
	});

	it("returns the stored value unvalidated when no schema is given", async () => {
		const { door } = fakeDoor([setting("k", { port: "eighty" })]);
		expect(await new ClusterSettings(door).read("k", null, null)).toEqual({ port: "eighty" });
	});

	it("writes the value as JSON through the door", async () => {
		const { door, writes } = fakeDoor([]);
		await new ClusterSettings(door).write("node.doors", { namePrefix: "deployer" });
		expect(writes).toEqual([{ key: "node.doors", value: '{"namePrefix":"deployer"}', updatedAt: 1 }]);
	});

	it("fails a write when no agent owns the door, never dropping the choice silently", async () => {
		const door: NodeDoorClient = { ...fakeDoor([]).door, writeSetting: () => Promise.resolve(null) };
		await expect(new ClusterSettings(door).write("ingress.lanes", {})).rejects.toThrow(/not written/);
	});
});

import { describe, expect, it } from "vitest";

import {
	isMeshTransport,
	MeshProcedure,
	MeshTransport,
	meshProceduresOf,
	NodeProcedure,
} from "./mesh-procedure.decorator";

@MeshTransport()
class Marked {
	@MeshProcedure({ door: "peer", group: "directory", contract: "directory.list" })
	list() {
		return "list";
	}

	@MeshProcedure({ door: "peer", group: "roster", key: "view", contract: "roster.view" })
	view() {
		return "view";
	}

	@NodeProcedure("node.state")
	state() {
		return "state";
	}
}

class Unmarked {
	@MeshProcedure({ door: "peer", group: "directory", contract: "directory.anything" })
	anything() {
		return "anything";
	}
}

describe("@MeshTransport", () => {
	it("marks the class itself, and only it", () => {
		expect(isMeshTransport(Marked)).toBe(true);
		expect(isMeshTransport(Unmarked)).toBe(false);
		expect(isMeshTransport("not a class")).toBe(false);
	});
});

describe("@MeshProcedure", () => {
	it("defaults the key to the method name", () => {
		expect(meshProceduresOf(new Marked()).get("list")).toMatchObject({ door: "peer", group: "directory", key: "list" });
	});

	it("keeps an explicit key", () => {
		expect(meshProceduresOf(new Marked()).get("view")).toMatchObject({ key: "view" });
	});

	it("does not execute anything: the method only runs when the router is built", () => {
		let calls = 0;
		class Counting {
			@MeshProcedure({ door: "peer", group: "g", contract: {} })
			run() {
				calls += 1;
				return "ran";
			}
		}
		const instance = new Counting();
		expect(calls).toBe(0);
		expect(meshProceduresOf(instance).size).toBe(1);
		expect(calls).toBe(0);
	});

	it("refuses two decorators on one method", () => {
		expect(() => {
			class Twice {
				@MeshProcedure({ door: "peer", group: "g", contract: {} })
				@MeshProcedure({ door: "node", group: "g", contract: {} })
				run() {
					return "ran";
				}
			}
			void Twice;
		}).toThrow(/twice/);
	});
});

describe("@NodeProcedure", () => {
	it("is sugar for the node door and group", () => {
		expect(meshProceduresOf(new Marked()).get("state")).toMatchObject({
			door: "node",
			group: "node",
			key: "state",
			contract: "node.state",
		});
	});

	it("does not mark the class", () => {
		expect(isMeshTransport(Marked)).toBe(true);
		expect(isMeshTransport(Unmarked)).toBe(false);
	});
});

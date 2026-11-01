import { describe, expect, it } from "vitest";

import { declareProcedures, isMeshController, MeshController } from "./mesh-controller";

describe("MeshController", () => {
	it("is detected by a global marker, so a second copy of the package still matches", () => {
		class Door extends MeshController {}
		class Plain {}

		expect(isMeshController(Door)).toBe(true);
		expect(isMeshController(Plain)).toBe(false);
		expect(isMeshController(undefined)).toBe(false);
	});

	it("declares nothing by default", () => {
		class Door extends MeshController {}

		expect(Door.procedures).toEqual({});
	});

	it("keeps the declaration as written, keyed by method name", () => {
		class Door extends MeshController {
			static readonly procedures = declareProcedures({
				verify: { door: "peer", group: "access", contract: "access.verify" },
				state: { door: "node", group: "node", contract: "node.state" },
			});

			verify() {
				return {};
			}
			state() {
				return {};
			}
		}

		expect(Object.keys(Door.procedures)).toEqual(["verify", "state"]);
		expect(Door.procedures.verify).toMatchObject({ door: "peer", group: "access" });
	});
});

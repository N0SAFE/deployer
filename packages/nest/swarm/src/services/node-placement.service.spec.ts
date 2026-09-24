import { describe, expect, it } from "vitest";
import { parsePlacementPolicyLabel, toSwarmPlacement } from "./node-placement.service";

describe("toSwarmPlacement", () => {
    it("default = no constraints (shared nodes)", () => {
        expect(toSwarmPlacement({ policy: "default" })).toEqual({ constraints: [], preferences: [] });
    });

    it("dedicated constrains to the tenant label", () => {
        const plan = toSwarmPlacement({ policy: "dedicated", tenantId: "project-1" });
        expect(plan.constraints).toEqual(["node.labels.deployer.tenant.project-1 == true"]);
        expect(plan.preferences).toEqual([]);
    });

    it("dedicated without tenant falls back to default", () => {
        expect(toSwarmPlacement({ policy: "dedicated" })).toEqual({ constraints: [], preferences: [] });
    });

    it("exclude-ingress constrains off ingress nodes", () => {
        expect(toSwarmPlacement({ policy: "exclude-ingress" }).constraints).toEqual([
            "node.labels.deployer.ingress != true",
        ]);
    });

    it("prefer-region adds a spread preference, no hard constraint", () => {
        const plan = toSwarmPlacement({ policy: "prefer-region", regionLabel: "eu-1" });
        expect(plan.constraints).toEqual([]);
        expect(plan.preferences).toEqual([{ spreadDescriptor: "node.labels.deployer.region" }]);
    });
});

describe("parsePlacementPolicyLabel", () => {
    it("parses known values", () => {
        expect(parsePlacementPolicyLabel("dedicated")).toBe("dedicated");
        expect(parsePlacementPolicyLabel("exclude-ingress")).toBe("exclude-ingress");
        expect(parsePlacementPolicyLabel("prefer-region")).toBe("prefer-region");
    });

    it("defaults unknown/missing", () => {
        expect(parsePlacementPolicyLabel(undefined)).toBe("default");
        expect(parsePlacementPolicyLabel("garbage")).toBe("default");
    });
});
import { describe, expect, it } from "vitest";
import {
    SWARM_NODE_LABEL_INGRESS,
    SWARM_NODE_LABEL_ROLE,
    ingressFromLabels,
    platformRoleForPolicy,
    platformRoleFromLabels,
    withIngress,
    withPlatformRole,
} from "./swarm-node-labels";

describe("platformRoleFromLabels", () => {
    it("reads a valid role from the node labels", () => {
        expect(platformRoleFromLabels({ [SWARM_NODE_LABEL_ROLE]: "control" })).toBe("control");
        expect(platformRoleFromLabels({ [SWARM_NODE_LABEL_ROLE]: "worker" })).toBe("worker");
        expect(platformRoleFromLabels({ [SWARM_NODE_LABEL_ROLE]: "both" })).toBe("both");
    });

    it("defaults to `both` when the label is absent (shared nodes)", () => {
        expect(platformRoleFromLabels({})).toBe("both");
        expect(platformRoleFromLabels(undefined)).toBe("both");
    });

    it("defaults to `both` for an unknown value instead of throwing", () => {
        // A label set by an older build (or a human) must never break a sweep.
        expect(platformRoleFromLabels({ [SWARM_NODE_LABEL_ROLE]: "master" })).toBe("both");
    });
});

describe("ingressFromLabels", () => {
    it("is true only for the exact `true` marker", () => {
        expect(ingressFromLabels({ [SWARM_NODE_LABEL_INGRESS]: "true" })).toBe(true);
        expect(ingressFromLabels({ [SWARM_NODE_LABEL_INGRESS]: "1" })).toBe(false);
        expect(ingressFromLabels({})).toBe(false);
    });
});

describe("withPlatformRole", () => {
    it("writes a non-default role", () => {
        expect(withPlatformRole({}, "control")).toEqual({ [SWARM_NODE_LABEL_ROLE]: "control" });
    });

    it("REMOVES the label for `both` (it is the default)", () => {
        expect(withPlatformRole({ [SWARM_NODE_LABEL_ROLE]: "worker" }, "both")).toEqual({});
    });

    it("leaves labels untouched when the role is null (partial update)", () => {
        const labels = { [SWARM_NODE_LABEL_INGRESS]: "true" };
        expect(withPlatformRole(labels, null)).toEqual(labels);
    });

    it("preserves unrelated labels", () => {
        expect(withPlatformRole({ keep: "me" }, "worker")).toEqual({
            keep: "me",
            [SWARM_NODE_LABEL_ROLE]: "worker",
        });
    });
});

describe("withIngress", () => {
    it("sets and clears the ingress marker", () => {
        expect(withIngress({}, true)).toEqual({ [SWARM_NODE_LABEL_INGRESS]: "true" });
        expect(withIngress({ [SWARM_NODE_LABEL_INGRESS]: "true" }, false)).toEqual({});
    });

    it("leaves labels untouched when the flag is null (partial update)", () => {
        const labels = { [SWARM_NODE_LABEL_ROLE]: "control" };
        expect(withIngress(labels, null)).toEqual(labels);
    });
});

describe("platformRoleForPolicy", () => {
    it("maps the participation policy to the ROLE vocabulary", () => {
        // `auto` = mixed manager+worker, `manager` = dedicated control plane.
        expect(platformRoleForPolicy("auto")).toBe("both");
        expect(platformRoleForPolicy("manager")).toBe("control");
        expect(platformRoleForPolicy("worker")).toBe("worker");
    });
});

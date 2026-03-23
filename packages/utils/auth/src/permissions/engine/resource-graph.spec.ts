import { describe, it, expect } from "vitest";
import { RESOURCE_GRAPH, getAncestorChain, isAncestorOf, MAX_CASCADE_DEPTH } from "./resource-graph";
import type { ProjectResource } from "./types";

describe("RESOURCE_GRAPH", () => {
    it("has an entry for every ProjectResource", () => {
        const expected: ProjectResource[] = [
            "project",
            "service",
            "deployment",
            "logs",
            "webhook",
            "apiKey",
            "environment",
        ];
        for (const r of expected) {
            expect(RESOURCE_GRAPH[r], `missing entry for "${r}"`).toBeDefined();
        }
    });

    it("project has no parent (root)", () => {
        expect(RESOURCE_GRAPH.project.parent).toBeNull();
    });

    it("service parent is project", () => {
        expect(RESOURCE_GRAPH.service.parent?.resource).toBe("project");
        expect(RESOURCE_GRAPH.service.parent?.foreignKey).toBe("projectId");
    });

    it("deployment parent is service", () => {
        expect(RESOURCE_GRAPH.deployment.parent?.resource).toBe("service");
        expect(RESOURCE_GRAPH.deployment.parent?.foreignKey).toBe("serviceId");
    });

    it("logs parent is deployment", () => {
        expect(RESOURCE_GRAPH.logs.parent?.resource).toBe("deployment");
        expect(RESOURCE_GRAPH.logs.parent?.foreignKey).toBe("deploymentId");
    });

    it("webhook parent is project", () => {
        expect(RESOURCE_GRAPH.webhook.parent?.resource).toBe("project");
    });

    it("apiKey parent is project", () => {
        expect(RESOURCE_GRAPH.apiKey.parent?.resource).toBe("project");
    });

    it("environment has no parent (project-scoped but root)", () => {
        expect(RESOURCE_GRAPH.environment.parent).toBeNull();
    });
});

describe("getAncestorChain", () => {
    it("project has empty ancestor chain", () => {
        expect(getAncestorChain("project")).toEqual([]);
    });

    it("service chain: [project]", () => {
        expect(getAncestorChain("service")).toEqual(["project"]);
    });

    it("deployment chain: [service, project]", () => {
        expect(getAncestorChain("deployment")).toEqual(["service", "project"]);
    });

    it("logs chain: [deployment, service, project]", () => {
        expect(getAncestorChain("logs")).toEqual(["deployment", "service", "project"]);
    });

    it("webhook chain: [project]", () => {
        expect(getAncestorChain("webhook")).toEqual(["project"]);
    });

    it("apiKey chain: [project]", () => {
        expect(getAncestorChain("apiKey")).toEqual(["project"]);
    });

    it("environment chain: []  (no parent in graph)", () => {
        expect(getAncestorChain("environment")).toEqual([]);
    });

    it("all chains are shorter than MAX_CASCADE_DEPTH", () => {
        const resources: ProjectResource[] = [
            "project",
            "service",
            "deployment",
            "logs",
            "webhook",
            "apiKey",
            "environment",
        ];
        for (const r of resources) {
            expect(getAncestorChain(r).length).toBeLessThan(MAX_CASCADE_DEPTH);
        }
    });
});

describe("isAncestorOf", () => {
    it("project is ancestor of service", () => {
        expect(isAncestorOf("project", "service")).toBe(true);
    });

    it("project is ancestor of deployment (transitive)", () => {
        expect(isAncestorOf("project", "deployment")).toBe(true);
    });

    it("project is ancestor of logs (transitive x2)", () => {
        expect(isAncestorOf("project", "logs")).toBe(true);
    });

    it("service is NOT ancestor of project", () => {
        expect(isAncestorOf("service", "project")).toBe(false);
    });

    it("deployment is NOT ancestor of service", () => {
        expect(isAncestorOf("deployment", "service")).toBe(false);
    });

    it("webhook is not ancestor of deployment", () => {
        expect(isAncestorOf("webhook", "deployment")).toBe(false);
    });

    it("resource is not ancestor of itself", () => {
        expect(isAncestorOf("project", "project")).toBe(false);
    });
});

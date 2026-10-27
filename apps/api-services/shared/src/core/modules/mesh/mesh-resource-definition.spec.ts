import { describe, expect, it } from "vitest";
import z from "zod/v4";

import { defineResource } from "./mesh-resource-definition";

describe("defineResource", () => {
  it("builds a resource with global ownership and its coordinator node", () => {
    const resource = defineResource()
      .key("projects")
      .itemSchema(z.object({ projectId: z.string(), name: z.string() }))
      .itemKey("projectId")
      .globalOwnership("mesh-coordinator")
      .build();

    expect(resource.key).toBe("projects");
    expect(resource.ownership).toEqual({ type: "global", coordinatorNode: "mesh-coordinator" });
  });

  it("builds a resource owned by the node named in an item field", () => {
    const resource = defineResource()
      .key("deployments")
      .itemSchema(z.object({ deploymentId: z.string(), nodeId: z.string() }))
      .itemKey("deploymentId")
      .nodeOwnedOwnership("nodeId")
      .build();

    expect(resource.ownership).toEqual({ type: "node-owned", ownerField: "nodeId" });
  });

  it("chains queries, mutations and event sources onto the definition", () => {
    const resource = defineResource()
      .key("services")
      .itemSchema(z.object({ serviceId: z.string(), name: z.string() }))
      .itemKey("serviceId")
      .globalOwnership()
      .addQuery("list", {
        inputSchema: z.object({}),
        outputSchema: z.object({ total: z.number() }),
        capabilities: { request: true, listen: true, paginate: true, sort: true, filter: true, project: true },
      })
      .addMutation("restart", {
        inputSchema: z.object({ serviceId: z.string() }),
        outputSchema: z.object({ success: z.boolean() }),
        capabilities: { returnsItem: false, batchable: false, emitsEvents: true, optimisticUpdates: false },
      })
      .addEventSource("changes", {
        type: "external",
        schema: z.object({ serviceId: z.string() }),
        emitsCreated: true,
        emitsUpdated: true,
        emitsDeleted: true,
        config: { system: "service-orchestrator" },
      })
      .build();

    expect(resource.queries.list).toBeDefined();
    expect(resource.mutations.restart).toBeDefined();
    expect(resource.eventSources.changes.config.system).toBe("service-orchestrator");
  });
});

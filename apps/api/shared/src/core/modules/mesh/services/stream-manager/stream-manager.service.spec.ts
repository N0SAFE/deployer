import { beforeEach, describe, expect, it } from "vitest";

import { MeshConnectionRegistry } from "../../connection/mesh-connection-registry";
import { generateConsumerId } from "../../filter/mesh-filter.types";
import type { MeshFilterDescriptor } from "../../filter/mesh-filter.types";
import { StreamManagerService } from "./stream-manager.service";

const prod: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
const prodOrStaging: MeshFilterDescriptor = { op: "in", field: "env", values: ["prod", "staging"] };

describe("StreamManagerService.getOrCreateAndAttach", () => {
  let registry: MeshConnectionRegistry;
  let manager: StreamManagerService;

  beforeEach(() => {
    registry = new MeshConnectionRegistry();
    manager = new StreamManagerService(registry);
  });

  it("opens a connection when none exists for the stream", async () => {
    const consumer = generateConsumerId();

    const conn = await manager.getOrCreateAndAttach("node-a", "deployments", "list", consumer, prod);

    expect(conn).toMatchObject({ nodeId: "node-a", entityKey: "deployments" });
    expect(conn?.consumers.has(consumer)).toBe(true);
  });

  it("attaches to the open connection when the new filter is a subset", async () => {
    await manager.getOrCreateAndAttach("node-a", "deployments", "list", generateConsumerId(), prodOrStaging);
    const second = generateConsumerId();

    const conn = await manager.getOrCreateAndAttach("node-a", "deployments", "list", second, prod);

    expect(conn?.consumers.has(second)).toBe(true);
    const open = registry.listOpen().filter((c) => c.nodeId === "node-a" && c.entityKey === "deployments");
    expect(open).toHaveLength(1);
    expect(open[0]?.consumers.size).toBe(2);
  });

  it("promotes the open connection to the wider filter when the new filter is a superset", async () => {
    await manager.getOrCreateAndAttach("node-a", "deployments", "list", generateConsumerId(), prod);
    const second = generateConsumerId();

    const conn = await manager.getOrCreateAndAttach("node-a", "deployments", "list", second, prodOrStaging);

    expect(conn?.consumers.has(second)).toBe(true);
    expect(conn?.serverFilter).toEqual(prodOrStaging);
  });

  it("reuses the same connection for a later subset, keeping every consumer on it", async () => {
    const first = await manager.getOrCreateAndAttach(
      "node-a", "deployments", "list", generateConsumerId(), prodOrStaging,
    );

    const second = await manager.getOrCreateAndAttach("node-a", "deployments", "list", generateConsumerId(), prod);

    expect(second?.id).toBe(first?.id);
    expect(second?.consumers.size).toBe(2);
  });
});

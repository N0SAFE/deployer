import { DatabaseSync } from "node:sqlite";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { AgentStore, agentStoreOver } from "../../../local/agent-store";

import { NodeSettings } from "./node-settings.service";

const fixture = () => {
  const store = agentStoreOver(new DatabaseSync(":memory:") as never);
  const run = <A, E>(effect: Effect.Effect<A, E, AgentStore>) =>
    Effect.runPromise(effect.pipe(Effect.provideService(AgentStore, store)));
  return { store, run };
};

describe("NodeSettings", () => {
  it("answers with nothing on a node nobody published to", async () => {
    expect(await fixture().run(new NodeSettings.live().all())).toEqual({ settings: [] });
  });

  it("serves every setting this node holds, with the writer's clock", async () => {
    const node = fixture();
    await Effect.runPromise(node.store.putSetting("node.doors", "{\"web\":80}", 1_700_000_000_000));

    expect(await node.run(new NodeSettings.live().all())).toEqual({
      settings: [{ key: "node.doors", value: "{\"web\":80}", updatedAt: 1_700_000_000_000 }],
    });
  });
});

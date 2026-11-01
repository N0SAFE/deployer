import { Context, Effect } from "effect";

import type { MeshNodeSetting } from "@deployer/node-agent-contracts";

import { AgentStore, type AgentStoreError } from "../../../local/agent-store";

export type NodeSettingsShape = {
  /** Every setting this node acts on, in key order. */
  readonly all: () => Effect.Effect<{ settings: MeshNodeSetting[] }, AgentStoreError, AgentStore>;
};

/**
 * The roster settings this node's agent holds: the answer the old control API gave on `/v1/settings`.
 *
 * Read-only on purpose: the settings are replicated (the API publishes them, gossip carries them), so a local write
 * would be replaced by the newest value anyway.
 */
export class NodeSettings extends Context.Service<NodeSettings, NodeSettingsShape>()("node-agent/NodeSettings") {
  static readonly live = class NodeSettingsImpl implements NodeSettingsShape {
    all() {
      return Effect.gen(function* () {
        const store = yield* AgentStore;
        const settings = yield* store.settings();
        return { settings: settings.map(({ key, value, updatedAt }) => ({ key, value, updatedAt })) };
      });
    }
  };
}

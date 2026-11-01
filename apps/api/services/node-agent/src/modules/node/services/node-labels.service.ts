import { Context, Effect } from "effect";

import { AgentStore, type AgentStoreError } from "../../../local/agent-store";

/** Where the node's own labels live: one JSON object in the store's secrets, so one write is one row. */
export const NODE_LABELS_SECRET = "node.labels";

export type NodeLabelsShape = {
  /** The labels this node publishes, `{}` when none were written or the stored value is malformed. */
  readonly read: () => Effect.Effect<Record<string, string>, AgentStoreError, AgentStore>;
  /** Adds facts to this node's labels without dropping the ones already there. Returns the merged map. */
  readonly merge: (labels: Record<string, string>) => Effect.Effect<Record<string, string>, AgentStoreError, AgentStore>;
};

/** Whatever is in the store, a label map or nothing: a malformed value must not break the roster. */
const parse = (raw: string | undefined): Record<string, string> => {
  if (raw === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
};

/**
 * The facts this node publishes about itself: `deployer.node-id` today, whatever the platform wants next. They ride in
 * the roster (`from` and `agents`), so a peer — and the dashboard through any agent — sees them.
 */
export class NodeLabels extends Context.Service<NodeLabels, NodeLabelsShape>()("node-agent/NodeLabels") {
  static readonly live = class NodeLabelsImpl implements NodeLabelsShape {
    read() {
      return Effect.gen(function* () {
        const store = yield* AgentStore;
        return parse(yield* store.secret(NODE_LABELS_SECRET));
      });
    }

    merge(labels) {
      return Effect.gen(function* () {
        const store = yield* AgentStore;
        const merged = { ...parse(yield* store.secret(NODE_LABELS_SECRET)), ...labels };
        yield* store.putSecret(NODE_LABELS_SECRET, JSON.stringify(merged));
        return merged;
      });
    }
  };
}

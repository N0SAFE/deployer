/** Node identity stamped on outbox rows when no mesh id is configured. */
export const DEFAULT_NODE_ID = "00000000-0000-4000-8000-000000000000";

/**
 * The node identity stamped on rows this process writes: `MESH_NODE_ID` from
 * `env` (default `process.env`) when it holds a non-blank value, else
 * `DEFAULT_NODE_ID`.
 */
export function resolveNodeId(env: Readonly<Record<string, string | undefined>> = process.env): string {
    const configured = env.MESH_NODE_ID?.trim();
    return configured && configured.length > 0 ? configured : DEFAULT_NODE_ID;
}

import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-node global network configuration — the "main IP/domain" of the System
 * config, scoped to a mesh node.
 *
 * The node is identified by `nodeId` (the same UUID as `cluster_nodes.nodeId`
 * and the local SQLite `node_config.nodeId`). No hard FK to `cluster_nodes`
 * on purpose: a standalone node may not be enrolled yet, but its network
 * config must still be persistable. The linkage is semantic.
 *
 * ── WHY THERE IS NO TUNNEL HERE ─────────────────────────────────────────
 * The tunnel columns used to live on this table, which made the tunnel a
 * property of a NODE — so a 3-node platform created 3 Cloudflare tunnels, each
 * needing its own hostname rule, with 3 connectors competing to answer for the
 * same hostname. The edge is a property of the STACK (one tunnel, up to 25
 * connectors, HA from replicas), so it lives in the local `platform_settings`
 * table alongside the entry port it is the alternative to.
 */
export const nodeNetworkConfig = pgTable(
    "node_network_config",
    {
        /** Mesh node this config belongs to (uuid — same as cluster_nodes.nodeId). */
        nodeId: text("node_id").primaryKey(),
        /**
         * The manually-configured globally reachable address: a bare IP
         * (203.0.113.10), a hostname (node.example.com) or a full origin+path.
         *
         * Still per-node, and still needed: in `direct` mode DNS resolves each
         * app hostname to THIS node's address, so the address is what makes the
         * stack reachable without a tunnel.
         */
        publicAddress: text("public_address"),
        /** Derived kind of `publicAddress`: "ip" | "hostname" | null. */
        addressKind: text("address_kind"),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
);

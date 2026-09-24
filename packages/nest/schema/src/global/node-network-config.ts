import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Per-node global network configuration — the "main IP/domain" of the System
 * config, now scoped to a mesh node.
 *
 * The node is identified by `nodeId` (the same UUID as `cluster_nodes.nodeId`
 * and the local SQLite `node_config.nodeId`). No hard FK to `cluster_nodes`
 * on purpose: a standalone node may not be enrolled yet, but its network
 * config must still be persistable. The linkage is semantic.
 */
export const nodeNetworkConfig = pgTable(
    "node_network_config",
    {
        /** Mesh node this config belongs to (uuid — same as cluster_nodes.nodeId). */
        nodeId: text("node_id").primaryKey(),
        /**
         * The manually-configured globally reachable address: a bare IP
         * (203.0.113.10), a hostname (node.example.com) or a full origin+path.
         * Null when the node is reached through a tunnel instead.
         */
        publicAddress: text("public_address"),
        /** Derived kind of `publicAddress`: "ip" | "hostname" | null. */
        addressKind: text("address_kind"),
        /** Whether the node is reached through a Cloudflare Tunnel. */
        tunnelEnabled: boolean("tunnel_enabled").notNull().default(false),
        /** DNS provider app that owns the tunnel (dns_providers.id). */
        tunnelProviderId: uuid("tunnel_provider_id"),
        /** Cloudflare tunnel id created automatically on the provider account. */
        tunnelId: text("tunnel_id"),
        /** Public hostname the tunnel exposes (CNAME target of the node). */
        tunnelHostname: text("tunnel_hostname"),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow()
            .$onUpdate(() => new Date()),
    },
);

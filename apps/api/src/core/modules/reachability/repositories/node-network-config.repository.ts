import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { GlobalDatabaseService } from "@/core/modules/database/global/global-database.service";
import * as globalSchema from "@/config/drizzle/global/schema";

type NodeNetworkConfigRow = typeof globalSchema.nodeNetworkConfig.$inferSelect;

/**
 * NodeNetworkConfigRepository — the single data-access layer for the global
 * `node_network_config` table. Extracted from ReachabilityService, which was
 * reaching into the DB directly (violating the service → repository
 * layering).
 */
@Injectable()
export class NodeNetworkConfigRepository {
    constructor(private readonly globalDatabaseService: GlobalDatabaseService) {}

    private get db() {
        return this.globalDatabaseService.db;
    }

    /** Load a node's network config row by node id. */
    async findByNodeId(nodeId: string): Promise<NodeNetworkConfigRow | null> {
        const rows = await this.db
            .select()
            .from(globalSchema.nodeNetworkConfig)
            .where(eq(globalSchema.nodeNetworkConfig.nodeId, nodeId))
            .limit(1);
        return rows[0] ?? null;
    }

    /** List every node's network config, most recently updated first. */
    async list(): Promise<NodeNetworkConfigRow[]> {
        return this.db
            .select()
            .from(globalSchema.nodeNetworkConfig)
            .orderBy(globalSchema.nodeNetworkConfig.updatedAt);
    }

    /** Upsert a node's network config (insert or update on nodeId conflict). */
    async upsert(input: {
        nodeId: string;
        publicAddress: string | null;
        addressKind: "ip" | "hostname" | null;
        tunnelEnabled: boolean;
        tunnelProviderId: string | null;
        tunnelId: string | null;
        tunnelHostname: string | null;
    }): Promise<void> {
        const values = {
            nodeId: input.nodeId,
            publicAddress: input.publicAddress,
            addressKind: input.addressKind,
            tunnelEnabled: input.tunnelEnabled,
            tunnelProviderId: input.tunnelProviderId,
            tunnelId: input.tunnelId,
            tunnelHostname: input.tunnelHostname,
            updatedAt: new Date(),
        };
        await this.db
            .insert(globalSchema.nodeNetworkConfig)
            .values(values)
            .onConflictDoUpdate({
                target: globalSchema.nodeNetworkConfig.nodeId,
                set: values,
            });
    }

    /**
     * Load a DNS provider row by id (tunnel-capability check).
     * Reads the global schema directly — this repository is the reachability
     * domain's data-access layer and must not import product modules.
     */
    async findTunnelProviderById(providerId: string) {
        const rows = await this.db
            .select({
                isActive: globalSchema.dnsProviders.isActive,
                features: globalSchema.dnsProviders.features,
                credentials: globalSchema.dnsProviders.credentials,
            })
            .from(globalSchema.dnsProviders)
            .where(eq(globalSchema.dnsProviders.id, providerId))
            .limit(1);
        return rows[0] ?? null;
    }
}
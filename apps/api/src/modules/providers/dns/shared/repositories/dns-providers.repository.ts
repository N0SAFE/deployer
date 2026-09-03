import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { GlobalDatabaseService } from "@/core/modules/database/global/global-database.service";
import * as globalSchema from "@/config/drizzle/global/schema";

type DnsProviderRow = typeof globalSchema.dnsProviders.$inferSelect;
type DnsProviderInsert = typeof globalSchema.dnsProviders.$inferInsert;

/**
 * DnsProvidersRepository — the single data-access layer for `dns_providers`
 * rows. Extracted from CloudflareAppService, which was reaching into the DB
 * directly (violating the service → repository layering).
 */
@Injectable()
export class DnsProvidersRepository {
    constructor(private readonly globalDatabaseService: GlobalDatabaseService) {}

    private get db() {
        return this.globalDatabaseService.db;
    }

    /** Load a provider row by id. */
    async findById(providerId: string): Promise<DnsProviderRow | null> {
        const rows = await this.db
            .select()
            .from(globalSchema.dnsProviders)
            .where(eq(globalSchema.dnsProviders.id, providerId))
            .limit(1);
        return rows[0] ?? null;
    }

    /** List provider rows, optionally filtered by provider type. */
    async list(providerType?: string): Promise<DnsProviderRow[]> {
        const query = this.db.select().from(globalSchema.dnsProviders);
        return providerType
            ? query.where(eq(globalSchema.dnsProviders.providerType, providerType))
            : query;
    }

    /** Create a provider row. */
    async create(values: DnsProviderInsert): Promise<DnsProviderRow | null> {
        const rows = await this.db
            .insert(globalSchema.dnsProviders)
            .values(values)
            .returning();
        return rows[0] ?? null;
    }

    /** Update a provider row by id. Returns the updated row or null. */
    async updateById(
        providerId: string,
        values: Partial<typeof globalSchema.dnsProviders.$inferInsert>,
    ): Promise<DnsProviderRow | null> {
        const rows = await this.db
            .update(globalSchema.dnsProviders)
            .set(values)
            .where(eq(globalSchema.dnsProviders.id, providerId))
            .returning();
        return rows[0] ?? null;
    }

    /** Delete a provider row by id. */
    async deleteById(providerId: string): Promise<void> {
        await this.db
            .delete(globalSchema.dnsProviders)
            .where(eq(globalSchema.dnsProviders.id, providerId));
    }

    /** Find the node that owns a tunnel backed by this provider (if any). */
    async findTunnelOwnerNode(providerId: string) {
        const refs = await this.db
            .select({ nodeId: globalSchema.nodeNetworkConfig.nodeId })
            .from(globalSchema.nodeNetworkConfig)
            .where(eq(globalSchema.nodeNetworkConfig.tunnelProviderId, providerId))
            .limit(1);
        return refs[0] ?? null;
    }
}
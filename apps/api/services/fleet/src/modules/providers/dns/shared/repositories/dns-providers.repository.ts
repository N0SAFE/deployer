import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { GlobalDatabaseService } from "@deployer/shared/core/modules/database/global/global-database.service";
import { dnsProviders } from "@deployer/nest-schema/global/fleet/dns-providers";

type DnsProviderRow = typeof dnsProviders.$inferSelect;
type DnsProviderInsert = typeof dnsProviders.$inferInsert;

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
            .from(dnsProviders)
            .where(eq(dnsProviders.id, providerId))
            .limit(1);
        return rows[0] ?? null;
    }

    /** List provider rows, optionally filtered by provider type. */
    async list(providerType?: string): Promise<DnsProviderRow[]> {
        const query = this.db.select().from(dnsProviders);
        return providerType
            ? query.where(eq(dnsProviders.providerType, providerType))
            : query;
    }

    /** Create a provider row. */
    async create(values: DnsProviderInsert): Promise<DnsProviderRow | null> {
        const rows = await this.db
            .insert(dnsProviders)
            .values(values)
            .returning();
        return rows[0] ?? null;
    }

    /** Update a provider row by id. Returns the updated row or null. */
    async updateById(
        providerId: string,
        values: Partial<typeof dnsProviders.$inferInsert>,
    ): Promise<DnsProviderRow | null> {
        const rows = await this.db
            .update(dnsProviders)
            .set(values)
            .where(eq(dnsProviders.id, providerId))
            .returning();
        return rows[0] ?? null;
    }

    /** Delete a provider row by id. */
    async deleteById(providerId: string): Promise<void> {
        await this.db
            .delete(dnsProviders)
            .where(eq(dnsProviders.id, providerId));
    }
}
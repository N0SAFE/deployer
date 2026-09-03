import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { GlobalDatabaseService } from "@/core/modules/database/global/global-database.service";
import * as globalSchema from "@/config/drizzle/global/schema";

/**
 * GitlabAppsRepository — the single data-access layer for GitLab account
 * configurations. Extracted from GitlabAppsController, which was reaching
 * into the DB directly (violating the controller → service → repository
 * layering).
 */
@Injectable()
export class GitlabAppsRepository {
    constructor(private readonly globalDatabaseService: GlobalDatabaseService) {}

    private get db() {
        return this.globalDatabaseService.db;
    }

    /** List all GitLab accounts, oldest first. */
    async list() {
        return this.db
            .select({
                id: globalSchema.gitlabApps.id,
                name: globalSchema.gitlabApps.name,
                url: globalSchema.gitlabApps.url,
                isActive: globalSchema.gitlabApps.isActive,
                createdAt: globalSchema.gitlabApps.createdAt,
                updatedAt: globalSchema.gitlabApps.updatedAt,
            })
            .from(globalSchema.gitlabApps)
            .orderBy(globalSchema.gitlabApps.createdAt);
    }

    /** Check whether an account with this name already exists. */
    async findByName(name: string) {
        const rows = await this.db
            .select({ id: globalSchema.gitlabApps.id })
            .from(globalSchema.gitlabApps)
            .where(eq(globalSchema.gitlabApps.name, name))
            .limit(1);
        return rows[0] ?? null;
    }

    /** Create a GitLab account row. */
    async create(input: {
        name: string;
        url: string;
        accessToken: string;
    }) {
        const [row] = await this.db
            .insert(globalSchema.gitlabApps)
            .values({
                name: input.name,
                url: input.url,
                accessToken: input.accessToken,
                isActive: true,
            })
            .returning();
        return row ?? null;
    }

    /** Delete a GitLab account row by id. Returns the removed id or null. */
    async deleteById(id: string) {
        const removed = await this.db
            .delete(globalSchema.gitlabApps)
            .where(eq(globalSchema.gitlabApps.id, id))
            .returning({ id: globalSchema.gitlabApps.id });
        return removed[0] ?? null;
    }
}
import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { GlobalDatabaseService } from "@deployer/shared/core/modules/database/global/global-database.service";
import { gitlabApps } from "@deployer/nest-schema/global/fleet/gitlab-provider";

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
                id: gitlabApps.id,
                name: gitlabApps.name,
                url: gitlabApps.url,
                isActive: gitlabApps.isActive,
                createdAt: gitlabApps.createdAt,
                updatedAt: gitlabApps.updatedAt,
            })
            .from(gitlabApps)
            .orderBy(gitlabApps.createdAt);
    }

    /** Check whether an account with this name already exists. */
    async findByName(name: string) {
        const rows = await this.db
            .select({ id: gitlabApps.id })
            .from(gitlabApps)
            .where(eq(gitlabApps.name, name))
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
            .insert(gitlabApps)
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
            .delete(gitlabApps)
            .where(eq(gitlabApps.id, id))
            .returning({ id: gitlabApps.id });
        return removed[0] ?? null;
    }
}
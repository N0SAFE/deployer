import { Injectable } from "@nestjs/common";
import { and, eq, isNotNull } from "drizzle-orm";
import { GlobalDatabaseService } from "@/core/modules/database/global/global-database.service";
import { projectScanConfig } from "@/config/drizzle/global/schema/project-scan-config";
import { imageProjectMembership } from "@/config/drizzle/global/schema/image-project-membership";

@Injectable()
export class DockerProjectScanConfigRepository {
    constructor(private readonly db: GlobalDatabaseService) {}

    /**
     * Check if auto-scan is enabled for any project that owns this image.
     * Returns true if at least one project with auto-scan enabled has this
     * image in its membership. If no membership is found, returns true
     * (default-deny for unidentified images).
     */
    async isImageAutoScanEnabled(imageIdentifierNormalized: string): Promise<boolean> {
        try {
            const rows = await this.db.db
                .select({ enabled: projectScanConfig.autoScanEnabled })
                .from(imageProjectMembership)
                .innerJoin(
                    projectScanConfig,
                    eq(imageProjectMembership.projectId, projectScanConfig.projectId),
                )
                .where(
                    and(
                        eq(imageProjectMembership.imageIdentifierNormalized, imageIdentifierNormalized),
                        eq(projectScanConfig.autoScanEnabled, true),
                    ),
                )
                .limit(1);

            return rows.length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Get the scan config for a specific project.
     */
    async getConfig(projectId: string) {
        const rows = await this.db.db
            .select()
            .from(projectScanConfig)
            .where(eq(projectScanConfig.projectId, projectId))
            .limit(1);
        return rows[0] ?? null;
    }
}

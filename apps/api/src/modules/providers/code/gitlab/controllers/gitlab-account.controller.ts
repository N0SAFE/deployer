/**
 * GitLab Apps Controller
 *
 * CRUD for GitLab account configurations stored in the database.
 * A GitLab account is an instance URL + a personal/project access token
 * (no OAuth app manifest — unlike GitHub). Managed through the web UI.
 */
import { Controller, Logger } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import { standardErrorOptions } from "@repo/orpc-utils";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { GitlabAppsRepository } from "../repositories/gitlab-apps.repository";
import z from "zod/v4";

/** GitLab instance URL must be an http(s) URL. */
const URL_SCHEMA = z.string().url();

@Controller()
export class GitlabAppsController {
    private readonly logger = new Logger(GitlabAppsController.name);

    constructor(private readonly gitlabAppsRepository: GitlabAppsRepository) {}

    @Implement(appContract.providers.code.gitlab.list)
    list() {
        return implement(appContract.providers.code.gitlab.list)
            .use(requireAuth())
            .handler(async () => {
                const rows = await this.gitlabAppsRepository.list();

                return {
                    apps: rows.map((r) => ({
                        id: r.id,
                        name: r.name,
                        url: r.url,
                        isActive: r.isActive,
                        createdAt: r.createdAt.toISOString(),
                        updatedAt: r.updatedAt.toISOString(),
                    })),
                    total: rows.length,
                };
            });
    }

    @Implement(appContract.providers.code.gitlab.create)
    create() {
        return implement(appContract.providers.code.gitlab.create)
            .use(requireAuth())
            .handler(async ({ input, errors }) => {
                const urlCheck = URL_SCHEMA.safeParse(input.url);
                if (!urlCheck.success) {
                    throw errors.BAD_REQUEST(
                        standardErrorOptions("validation", `Invalid GitLab URL: ${input.url}`),
                    );
                }

                // Name uniqueness (409).
                const dup = await this.gitlabAppsRepository.findByName(input.name);
                if (dup) {
                    throw errors.CONFLICT(
                        standardErrorOptions("conflict", `A GitLab account named '${input.name}' already exists`),
                    );
                }

                const row = await this.gitlabAppsRepository.create({
                    name: input.name,
                    url: input.url,
                    accessToken: input.accessToken,
                });

                if (!row) {
                    throw errors.BAD_REQUEST(
                        standardErrorOptions("validation", "Failed to create GitLab account"),
                    );
                }

                return {
                    id: row.id,
                    name: row.name,
                    url: row.url,
                    isActive: row.isActive,
                    createdAt: row.createdAt.toISOString(),
                    updatedAt: row.updatedAt.toISOString(),
                };
            });
    }

    @Implement(appContract.providers.code.gitlab.delete)
    delete() {
        return implement(appContract.providers.code.gitlab.delete)
            .use(requireAuth())
            .handler(async ({ input, errors }) => {
                const id = input.params.id;
                const removed = await this.gitlabAppsRepository.deleteById(id);

                if (!removed) {
                    throw errors.NOT_FOUND(
                        standardErrorOptions("not_found", `GitLab account '${id}' not found`),
                    );
                }
                return { success: true };
            });
    }
}

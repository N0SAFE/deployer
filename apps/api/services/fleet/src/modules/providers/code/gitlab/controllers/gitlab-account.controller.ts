/**
 * GitLab Apps Controller
 *
 * CRUD for GitLab account configurations stored in the database.
 * A GitLab account is an instance URL + a personal/project access token
 * (no OAuth app manifest — unlike GitHub). Managed through the web UI.
 */
import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { providersContract } from "@deployer/fleet-contracts";
import { procedure } from "@deployer/nest-effect";
import { requireAuth } from "@deployer/shared/core/modules/auth/orpc/middlewares";
import { Effect } from "effect";
import z from "zod/v4";

import { FleetConflict, FleetInvalid, FleetNotFound } from "@/core/fleet.errors";
import { serve } from "@/core/orpc/serve";
import { GitlabAppsStore } from "../repositories/gitlab-apps.repository";

/** GitLab instance URL must be an http(s) URL. */
const URL_SCHEMA = z.string().url();

@Controller()
export class GitlabAppsController {
    @Implement(providersContract.code.gitlab.list)
    list() {
        return procedure(providersContract.code.gitlab.list)
            .use(requireAuth())
            .effect(function* ({ context }) {
                const apps = yield* GitlabAppsStore;
                const rows = yield* serve(context)(apps.list());

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

    @Implement(providersContract.code.gitlab.create)
    create() {
        return procedure(providersContract.code.gitlab.create)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const apps = yield* GitlabAppsStore;
                const row = yield* serve(context)(
                    Effect.gen(function* () {
                        const urlCheck = URL_SCHEMA.safeParse(input.url);
                        if (!urlCheck.success) {
                            return yield* new FleetInvalid({ reason: `Invalid GitLab URL: ${input.url}` });
                        }

                        // Name uniqueness (409).
                        const dup = yield* apps.findByName(input.name);
                        if (dup) {
                            return yield* new FleetConflict({ reason: `A GitLab account named '${input.name}' already exists` });
                        }

                        const created = yield* apps.create({
                            name: input.name,
                            url: input.url,
                            accessToken: input.accessToken,
                        });
                        if (!created) {
                            return yield* new FleetInvalid({ reason: "Failed to create GitLab account" });
                        }
                        return created;
                    }),
                );

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

    @Implement(providersContract.code.gitlab.delete)
    delete() {
        return procedure(providersContract.code.gitlab.delete)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const apps = yield* GitlabAppsStore;
                const id = input.params.id;
                return yield* serve(context)(
                    Effect.gen(function* () {
                        const removed = yield* apps.deleteById(id);
                        if (!removed) {
                            return yield* new FleetNotFound({ reason: `GitLab account '${id}' not found` });
                        }
                        return { success: true };
                    }),
                );
            });
    }
}

/**
 * GitLab Code Provider Contracts
 *
 * Account CRUD for GitLab source provider configurations. A GitLab account is
 * an instance URL + a personal/project access token (no OAuth app manifest,
 * unlike GitHub). Exposed as `orpc.providers.code.gitlab.*`.
 */
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import z from "zod/v4";

// ─── Schemas ──────────────────────────────────────────────────────────────

export const gitlabAppConfigSchema = z.object({
    id: z.string(),
    name: z.string().min(1, "Name is required"),
    url: z.string().min(1, "GitLab URL is required"),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const createGitlabAppInputSchema = z.object({
    name: z.string().min(1, "Name is required"),
    url: z.string().min(1, "GitLab URL is required"),
    accessToken: z.string().min(1, "Access token is required"),
});

const gitlabAppListOutputSchema = z.object({
    apps: z.array(gitlabAppConfigSchema),
    total: z.number(),
});

const gitlabAppOps = standard.zod(gitlabAppConfigSchema, "gitlabApp");

// ─── Contracts ────────────────────────────────────────────────────────────

export const gitlabAppListContract = gitlabAppOps
    .list()
    .path("/gitlab/apps")
    .input(z.object({}))
    .output(gitlabAppListOutputSchema)
    .build();

export const gitlabAppCreateContract = gitlabAppOps
    .create()
    .path("/gitlab/apps")
    .input((b) => b.body(createGitlabAppInputSchema))
    .output(gitlabAppConfigSchema)
    .errors((e) => [
        // 409 duplicate name; 400 invalid URL/token.
        ...standardDomainErrorContracts(e),
    ])
    .build();

export const gitlabAppDeleteContract = gitlabAppOps
    .delete()
    .input((b) => b.params((p) => p`/gitlab/apps/${p("id", z.string())}`))
    .output(z.object({ success: z.boolean() }))
    .errors((e) => [
        // 404 for unknown app id.
        ...standardDomainErrorContracts(e),
    ])
    .build();

export const gitlabAppContract = {
    list: gitlabAppListContract,
    create: gitlabAppCreateContract,
    delete: gitlabAppDeleteContract,
};

import { Context, Effect } from "effect";
import z from "zod/v4";

import { gitlabSourceCheckoutContextSchema } from "@deployer/contracts-entities";

import { RuntimeInvalid } from "../../../../../core/runtime.errors";
import { SourceGitPort } from "../../../providers.ports";
import { matchesSourceType, type CodeProviderShape } from "../../shared/code-provider.interface";

const gitlabSourceContextSchema = z.object({
    repositoryUrl: z.string().min(1),
    branch: z.string().min(1).optional(),
    commitSha: z.string().min(1).optional(),
    mergeRequestIid: z.number().int().positive().optional(),
});

export class GitlabSourceProvider extends Context.Service<GitlabSourceProvider, CodeProviderShape>()(
    "runtime/GitlabSourceProvider",
) {}

/** The gitlab provider over its git port. */
export function makeGitlabSourceProvider(ports: { readonly git: SourceGitPort["Service"] }): CodeProviderShape {
    const sourceType = "gitlab";
    return {
        sourceType,
        resolveSourceCheckout: (input) =>
            Effect.gen(function* () {
                if (!matchesSourceType(sourceType, input) || input.source.sourceType !== "gitlab") {
                    return null;
                }

                const parsed = gitlabSourceContextSchema.safeParse({
                    repositoryUrl: input.source.repositoryUrl,
                    branch: input.source.branch,
                    commitSha: input.source.commitSha,
                    mergeRequestIid: input.source.mergeRequestIid,
                });
                if (!parsed.success) {
                    return yield* new RuntimeInvalid({ reason: "GitLab source requires source.repositoryUrl" });
                }

                const { repositoryUrl, branch, commitSha, mergeRequestIid } = parsed.data;
                // GitLab merge-request pipelines target `refs/merge-requests/<iid>/head`.
                const resolvedBranch =
                    branch ?? (mergeRequestIid ? `refs/merge-requests/${mergeRequestIid}/head` : "main");

                const isValidRepository = yield* ports.git.validateRepository(repositoryUrl);
                if (!isValidRepository) {
                    return yield* new RuntimeInvalid({ reason: `GitLab repository '${repositoryUrl}' is not accessible` });
                }

                return gitlabSourceCheckoutContextSchema.parse({
                    provider: "gitlab",
                    repositoryUrl,
                    branch: resolvedBranch,
                    ...(commitSha ? { commitSha } : {}),
                    ...(mergeRequestIid ? { mergeRequestIid } : {}),
                });
            }),
    };
}

import { Context, Effect } from "effect";
import z from "zod/v4";

import { githubSourceCheckoutContextSchema } from "@deployer/contracts-entities";

import { RuntimeInvalid } from "../../../../../core/runtime.errors";
import { SourceGitPort } from "../../../providers.ports";
import { matchesSourceType, type CodeProviderShape } from "../../shared/code-provider.interface";

const githubSourceContextSchema = z.object({
    repositoryUrl: z.string().min(1),
    branch: z.string().min(1).optional(),
    commitSha: z.string().min(1).optional(),
    pullRequestNumber: z.number().int().positive().optional(),
});

export class GithubSourceProvider extends Context.Service<GithubSourceProvider, CodeProviderShape>()(
    "runtime/GithubSourceProvider",
) {}

/** The github provider over its git port. */
export function makeGithubSourceProvider(ports: { readonly git: SourceGitPort["Service"] }): CodeProviderShape {
    const sourceType = "github";
    return {
        sourceType,
        resolveSourceCheckout: (input) =>
            Effect.gen(function* () {
                if (!matchesSourceType(sourceType, input) || input.source.sourceType !== "github") {
                    return null;
                }

                const parsed = githubSourceContextSchema.safeParse({
                    repositoryUrl: input.source.repositoryUrl,
                    branch: input.source.branch,
                    commitSha: input.source.commitSha,
                    pullRequestNumber: input.source.pullRequestNumber,
                });
                if (!parsed.success) {
                    return yield* new RuntimeInvalid({ reason: "GitHub source requires source.repositoryUrl" });
                }

                const { repositoryUrl, branch, commitSha, pullRequestNumber } = parsed.data;
                const resolvedBranch = branch ?? (pullRequestNumber ? `refs/pull/${pullRequestNumber}/head` : "main");

                const isValidRepository = yield* ports.git.validateRepository(repositoryUrl);
                if (!isValidRepository) {
                    return yield* new RuntimeInvalid({ reason: `GitHub repository '${repositoryUrl}' is not accessible` });
                }

                return githubSourceCheckoutContextSchema.parse({
                    provider: "github",
                    repositoryUrl,
                    branch: resolvedBranch,
                    ...(commitSha ? { commitSha } : {}),
                    ...(pullRequestNumber ? { pullRequestNumber } : {}),
                });
            }),
    };
}

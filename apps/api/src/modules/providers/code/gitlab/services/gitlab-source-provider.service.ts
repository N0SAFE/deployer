import { BadRequestException, Injectable } from "@nestjs/common";
import { GitService } from "@/core/modules/git";
import type { DeploymentTriggerInput } from "@repo/api-contracts/modules/deployment/crud";
import z from "zod/v4";
import type { DeploymentSourceCheckoutContext } from "../../../base/source-provider.interface";
import { gitlabSourceCheckoutContextSchema } from "../../../base/source-provider.interface";
import { CodeProvider } from "../../shared/code-provider.interface";

const gitlabSourceContextSchema = z.object({
    repositoryUrl: z.string().min(1),
    branch: z.string().min(1).optional(),
    commitSha: z.string().min(1).optional(),
    mergeRequestIid: z.number().int().positive().optional(),
});

@Injectable()
export class GitlabSourceProviderService extends CodeProvider {
    readonly sourceType = "gitlab";

    constructor(private readonly gitService: GitService) {
        super();
    }

    async resolveSourceCheckout(
        input: DeploymentTriggerInput,
    ): Promise<DeploymentSourceCheckoutContext | null> {
        if (!this.matchesSourceType(input)) {
            return null;
        }

        if (input.source.sourceType !== "gitlab") {
            return null;
        }

        const parsed = gitlabSourceContextSchema.safeParse({
            repositoryUrl: input.source.repositoryUrl,
            branch: input.source.branch,
            commitSha: input.source.commitSha,
            mergeRequestIid: input.source.mergeRequestIid,
        });
        if (!parsed.success) {
            throw new BadRequestException("GitLab source requires source.repositoryUrl");
        }

        const { repositoryUrl, branch, commitSha, mergeRequestIid } = parsed.data;
        // GitLab merge-request pipelines target `refs/merge-requests/<iid>/head`.
        const resolvedBranch =
            branch ?? (mergeRequestIid ? `refs/merge-requests/${mergeRequestIid}/head` : "main");

        const isValidRepository = await this.gitService.validateRepository(repositoryUrl);
        if (!isValidRepository) {
            throw new BadRequestException(
                `GitLab repository '${repositoryUrl}' is not accessible`,
            );
        }

        return gitlabSourceCheckoutContextSchema.parse({
            provider: "gitlab",
            repositoryUrl,
            branch: resolvedBranch,
            ...(commitSha ? { commitSha } : {}),
            ...(mergeRequestIid ? { mergeRequestIid } : {}),
        });
    }
}

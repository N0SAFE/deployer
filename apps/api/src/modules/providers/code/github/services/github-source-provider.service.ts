import { BadRequestException, Injectable } from "@nestjs/common";
import { GitService } from "@/core/modules/git";
import type { DeploymentTriggerInput } from "@repo/api-contracts/modules/deployment/crud";
import z from "zod/v4";
import type { DeploymentSourceCheckoutContext } from "../../../base/source-provider.interface";
import { githubSourceCheckoutContextSchema } from "../../../base/source-provider.interface";
import { CodeProvider } from "../../shared/code-provider.interface";

const githubSourceContextSchema = z.object({
    repositoryUrl: z.string().min(1),
    branch: z.string().min(1).optional(),
    commitSha: z.string().min(1).optional(),
    pullRequestNumber: z.number().int().positive().optional(),
});

@Injectable()
export class GithubSourceProviderService extends CodeProvider {
    readonly sourceType = "github";

    constructor(private readonly gitService: GitService) {
        super();
    }

    async resolveSourceCheckout(
        input: DeploymentTriggerInput,
    ): Promise<DeploymentSourceCheckoutContext | null> {
        if (!this.matchesSourceType(input)) {
            return null;
        }

        if (input.source.sourceType !== "github") {
            return null;
        }

        const parsed = githubSourceContextSchema.safeParse({
            repositoryUrl: input.source.repositoryUrl,
            branch: input.source.branch,
            commitSha: input.source.commitSha,
            pullRequestNumber: input.source.pullRequestNumber,
        });
        if (!parsed.success) {
            throw new BadRequestException("GitHub source requires source.repositoryUrl");
        }

        const { repositoryUrl, branch, commitSha, pullRequestNumber } = parsed.data;
        const resolvedBranch = branch ?? (pullRequestNumber ? `refs/pull/${pullRequestNumber}/head` : "main");

        const isValidRepository = await this.gitService.validateRepository(repositoryUrl);
        if (!isValidRepository) {
            throw new BadRequestException(
                `GitHub repository '${repositoryUrl}' is not accessible`,
            );
        }

        return githubSourceCheckoutContextSchema.parse({
            provider: "github",
            repositoryUrl,
            branch: resolvedBranch,
            ...(commitSha ? { commitSha } : {}),
            ...(pullRequestNumber ? { pullRequestNumber } : {}),
        });
    }
}
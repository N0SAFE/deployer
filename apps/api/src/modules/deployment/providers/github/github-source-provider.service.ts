import { BadRequestException, Injectable } from "@nestjs/common";
import { GitService } from "@/core/modules/git";
import type { DeploymentTriggerInput } from "@repo/api-contracts/modules/deployment/crud";
import z from "zod/v4";
import type {
    DeploymentSourceCheckoutContext,
    DeploymentSourceProvider,
} from "../base/source-provider.interface";
import { githubSourceCheckoutContextSchema } from "../base/source-provider.interface";

const githubSourceContextSchema = z.object({
    repositoryUrl: z.string().min(1),
    branch: z.string().min(1).optional(),
    commitSha: z.string().min(1).optional(),
    pullRequestNumber: z.number().int().positive().optional(),
});

@Injectable()
export class GithubSourceProviderService implements DeploymentSourceProvider {
    readonly sourceType = "github";

    constructor(private readonly gitService: GitService) {}

    async resolveSourceCheckout(
        input: DeploymentTriggerInput,
    ): Promise<DeploymentSourceCheckoutContext | null> {
        if (input.sourceType !== "github") {
            return null;
        }

        const parsed = githubSourceContextSchema.safeParse(input.sourceConfig);
        if (!parsed.success) {
            throw new BadRequestException("GitHub source requires sourceConfig.repositoryUrl");
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
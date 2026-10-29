import type { GithubDeploymentRulesRepository } from "@deployer/shared/core/modules/git/github/repositories/github-deployment-rules.repository";
import { Context } from "effect";

/** Effect view of the per-project GitHub deployment rules: the active ones, in priority order. */
export type GithubDeploymentRulesShape = Pick<GithubDeploymentRulesRepository, "findActiveByProjectId">;

export class GithubDeploymentRules extends Context.Service<GithubDeploymentRules, GithubDeploymentRulesShape>()(
	"fleet/GithubDeploymentRules",
) {}

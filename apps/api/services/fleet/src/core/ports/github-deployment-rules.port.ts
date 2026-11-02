import { Context } from "effect";

import type { GithubDeploymentRulesRepository } from "@deployer/shared/core/modules/git/github/repositories/github-deployment-rules.repository";

/** Effect view of the per-project GitHub deployment rules: the active ones, in priority order. */
export type GithubDeploymentRulesShape = Pick<GithubDeploymentRulesRepository, "findActiveByProjectId">;

export class GithubDeploymentRules extends Context.Service<GithubDeploymentRules, GithubDeploymentRulesShape>()(
	"fleet/GithubDeploymentRules",
) {}

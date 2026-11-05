import { Context } from "effect";

import type { GitHubServiceShape } from "@deployer/shared/core/modules/git/github/services/github.service";

/** Effect view of the GitHub App client: what the GitHub accounts page asks of it. */
export type GitHubShape = Pick<
	GitHubServiceShape,
	| "registerInstallation"
	| "createFromManifestCode"
	| "exchangeCodeForToken"
	| "listInstallations"
	| "listInstallationRepositories"
	| "listRepositoryBranches"
	| "listRepositoryRoot"
	| "listRepositoryFiles"
	| "getRepositoryFileContent"
>;

export class GitHub extends Context.Service<GitHub, GitHubShape>()("fleet/GitHub") {}

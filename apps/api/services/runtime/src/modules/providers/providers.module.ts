import { Module } from "@nestjs/common";

import { GitModule } from "@deployer/shared/core/modules/git/index";
import { CodeProvider } from "./code/shared/code-provider.interface";
import { CodeProviderRegistryService } from "./code/shared/code-provider-registry.service";
import { CustomSourceProviderService } from "./code/custom/services/custom-source-provider.service";
import { GithubSourceProviderService } from "./code/github/services/github-source-provider.service";
import { GitlabSourceProviderService } from "./code/gitlab/services/gitlab-source-provider.service";
import { UploadSourceProviderService } from "./code/upload/services/upload-source-provider.service";
import { UploadBundleRegistryService } from "./code/upload/services/upload-bundle-registry.service";

/**
 * The runtime's SOURCE providers.
 *
 * ── WHY THIS LIVES IN RUNTIME AND NOT IN FLEET ──────────────────────────────
 * These four providers answer one question — "given a deployment trigger, what do I
 * check out?" — and their vocabulary is the RUNTIME contract's (`DeploymentTriggerInput`,
 * `DeploymentSourceCheckoutContext`). Their only in-process caller is this service's
 * `DeploymentService`, mid-build. Nothing in fleet reads them: fleet's own GitHub stack
 * (`preview-provisioning`) resolves DNS and preview rows, not source checkouts.
 *
 * Keeping them in fleet made the deployment workflow reach ACROSS a service boundary on
 * every deploy, which is the coupling the split exists to remove. Fleet keeps the GitHub
 * *app* (installations, OAuth, webhooks) because that is fleet state; runtime keeps the
 * *source resolution* because that is build machinery.
 *
 * ── WHY STILL AN ARRAY UNDER ONE TOKEN ──────────────────────────────────────
 * The registry dispatches by `sourceType`, so the providers must reach it as a
 * COLLECTION. Binding them under `CodeProvider` with `multi: true` is what lets a fifth
 * provider be added by listing it here, with no change to the registry or its callers.
 */
@Module({
	imports: [GitModule],
	providers: [
		GithubSourceProviderService,
		GitlabSourceProviderService,
		UploadSourceProviderService,
		CustomSourceProviderService,
		{
			provide: CodeProvider,
			useFactory: (
				github: GithubSourceProviderService,
				gitlab: GitlabSourceProviderService,
				upload: UploadSourceProviderService,
				custom: CustomSourceProviderService,
			) => [github, gitlab, upload, custom],
			inject: [
				GithubSourceProviderService,
				GitlabSourceProviderService,
				UploadSourceProviderService,
				CustomSourceProviderService,
			],
		},
		{
			provide: CodeProviderRegistryService,
			useFactory: (providers: CodeProvider[]) => new CodeProviderRegistryService(providers),
			inject: [CodeProvider],
		},
		UploadBundleRegistryService,
	],
	exports: [CodeProviderRegistryService, UploadBundleRegistryService],
})
export class ProviderDomainsModule {}

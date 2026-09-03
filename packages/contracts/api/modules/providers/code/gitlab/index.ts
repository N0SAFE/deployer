/**
 * GitLab Code Provider Contracts
 *
 * Aggregated router for the GitLab code provider: account config CRUD
 * (list/create/delete). Exposed as `orpc.providers.code.gitlab.*`.
 */
import { gitlabAppContract } from "./contracts";

export * from "./contracts";

export const gitlabCodeProviderContract = gitlabAppContract;

export type GitlabCodeProviderContract = typeof gitlabCodeProviderContract;

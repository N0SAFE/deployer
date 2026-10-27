/**
 * GitHub Code Provider Contracts
 *
 * Aggregated router for the GitHub code provider: app config CRUD, OAuth,
 * manifest flow, repo listing, branch listing, runner detection, and the
 * install callback. Exposed as `orpc.providers.code.github.*`.
 */
import { githubAppContract } from "./contracts";

export * from "./contracts";

export const githubCodeProviderContract = githubAppContract;

export type GithubCodeProviderContract = typeof githubCodeProviderContract;

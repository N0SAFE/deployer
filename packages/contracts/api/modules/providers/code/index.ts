/**
 * Code Providers Contract Router
 *
 * Top-level router for all CODE providers (github, gitlab, ...).
 * Each provider variant owns its own sub-router exposed as
 * `orpc.providers.code.<variant>.*`.
 */
import { oc } from "@orpc/contract";
import { githubCodeProviderContract } from "./github";
import { gitlabCodeProviderContract } from "./gitlab";

export const codeProvidersContract = oc.router({
    github: githubCodeProviderContract,
    gitlab: gitlabCodeProviderContract,
});

export type CodeProvidersContract = typeof codeProvidersContract;

export { githubCodeProviderContract } from "./github";
export { gitlabCodeProviderContract } from "./gitlab";

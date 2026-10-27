/**
 * Source Checkout Context Schemas — SSOT lives in @deployer/contracts-entities
 * (entities/deployment/source-checkout.schema.ts). This file re-exports the
 * schemas + keeps the API-side DeploymentSourceProvider contract.
 */
import type { DeploymentTriggerInput } from "@deployer/runtime-contracts/modules/deployment/crud";
import type { DeploymentSourceCheckoutContext } from "@deployer/contracts-entities";

export {
    githubSourceCheckoutContextSchema,
    gitlabSourceCheckoutContextSchema,
    uploadSourceCheckoutContextSchema,
    customSourceCheckoutContextSchema,
    deploymentSourceCheckoutContextSchema,
    type GithubSourceCheckoutContext,
    type GitlabSourceCheckoutContext,
    type UploadSourceCheckoutContext,
    type CustomSourceCheckoutContext,
} from "@deployer/contracts-entities";
export type { DeploymentSourceCheckoutContext } from "@deployer/contracts-entities";

export type DeploymentSourceProvider = {
    readonly sourceType: string;
    resolveSourceCheckout(input: DeploymentTriggerInput): Promise<DeploymentSourceCheckoutContext | null>;
}
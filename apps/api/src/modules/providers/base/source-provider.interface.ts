/**
 * Source Checkout Context Schemas — SSOT lives in @repo/contracts-entities
 * (entities/deployment/source-checkout.schema.ts). This file re-exports the
 * schemas + keeps the API-side DeploymentSourceProvider contract.
 */
import type { DeploymentTriggerInput } from "@repo/api-contracts/modules/deployment/crud";
import type { DeploymentSourceCheckoutContext } from "@repo/contracts-entities";

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
} from "@repo/contracts-entities";
export type { DeploymentSourceCheckoutContext } from "@repo/contracts-entities";

export interface DeploymentSourceProvider {
    readonly sourceType: string;
    resolveSourceCheckout(input: DeploymentTriggerInput): Promise<DeploymentSourceCheckoutContext | null>;
}
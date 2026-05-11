import { standard } from "@repo/orpc-utils";
import {
    deploymentRetryPolicyCatalogResultSchema,
    deploymentRetryPolicyListInputSchema,
    deploymentRetryPolicyResolveInputSchema,
    deploymentRetryPolicyResolveResultSchema,
} from "@repo/contracts-entities";

const deploymentRetryPolicyCatalogOps = standard.zod(
    deploymentRetryPolicyCatalogResultSchema,
    "deploymentRetryPolicyCatalog",
);
const deploymentRetryPolicyResolveOps = standard.zod(
    deploymentRetryPolicyResolveResultSchema,
    "deploymentRetryPolicyResolve",
);

export const deploymentListRetryPoliciesContract = deploymentRetryPolicyCatalogOps
    .list()
    .path("/retry-policies")
    .input((b) => b.query(deploymentRetryPolicyListInputSchema))
    .output(deploymentRetryPolicyCatalogResultSchema)
    .build();

export const deploymentResolveRetryPolicyContract = deploymentRetryPolicyResolveOps
    .create()
    .path("/retry-policies/resolve")
    .input((b) => b.body(deploymentRetryPolicyResolveInputSchema))
    .output(deploymentRetryPolicyResolveResultSchema)
    .build();

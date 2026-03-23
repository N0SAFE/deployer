import { route } from "@repo/orpc-utils/builder";
import {
    deploymentRetryPolicyCatalogResultSchema,
    deploymentRetryPolicyListInputSchema,
    deploymentRetryPolicyResolveInputSchema,
    deploymentRetryPolicyResolveResultSchema,
} from "@repo/api-contracts/common/deployment";

export const deploymentListRetryPoliciesContract = route({
    method: "GET",
    path: "/retry-policies",
    summary: "List deployment retry/backoff policies by job/node/task type",
})
    .input(deploymentRetryPolicyListInputSchema)
    .output(deploymentRetryPolicyCatalogResultSchema)
    .build();

export const deploymentResolveRetryPolicyContract = route({
    method: "POST",
    path: "/retry-policies/resolve",
    summary: "Resolve retry/backoff decision for a deployment job node/task attempt",
})
    .input((b) => b.body(deploymentRetryPolicyResolveInputSchema))
    .output(deploymentRetryPolicyResolveResultSchema)
    .build();

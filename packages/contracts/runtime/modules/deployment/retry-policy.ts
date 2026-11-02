import {
    deploymentRetryPolicyCatalogResultSchema,
    deploymentRetryPolicyListInputSchema,
    deploymentRetryPolicyResolveInputSchema,
    deploymentRetryPolicyResolveResultSchema,
} from "@deployer/contracts-entities";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

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
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const deploymentResolveRetryPolicyContract = deploymentRetryPolicyResolveOps
    .create()
    .path("/retry-policies/resolve")
    .input((b) => b.body(deploymentRetryPolicyResolveInputSchema))
    .output(deploymentRetryPolicyResolveResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

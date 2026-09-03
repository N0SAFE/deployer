import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import {
    deploymentPhaseTransitionApplyInputSchema,
    deploymentPhaseTransitionApplyResultSchema,
    deploymentPhaseTransitionsCatalogSchema,
    deploymentPhaseTransitionValidationInputSchema,
    deploymentPhaseTransitionValidationResultSchema,
} from "@repo/contracts-entities";

const deploymentPhaseTransitionsCatalogOps = standard.zod(
    deploymentPhaseTransitionsCatalogSchema,
    "deploymentPhaseTransitionsCatalog",
);
const deploymentPhaseTransitionValidationOps = standard.zod(
    deploymentPhaseTransitionValidationResultSchema,
    "deploymentPhaseTransitionValidation",
);
const deploymentPhaseTransitionApplyOps = standard.zod(
    deploymentPhaseTransitionApplyResultSchema,
    "deploymentPhaseTransitionApply",
);

export const deploymentListPhaseTransitionsContract = deploymentPhaseTransitionsCatalogOps
    .list()
    .path("/phase-machine/transitions")
    .input((b) =>
        b.query(
            z.object({
                from: z.string().optional(),
                to: z.string().optional(),
            }),
        ),
    )
    .output(deploymentPhaseTransitionsCatalogSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const deploymentValidatePhaseTransitionContract = deploymentPhaseTransitionValidationOps
    .create()
    .path("/phase-machine/validate")
    .input((b) => b.body(deploymentPhaseTransitionValidationInputSchema))
    .output(deploymentPhaseTransitionValidationResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const deploymentApplyPhaseTransitionContract = deploymentPhaseTransitionApplyOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/phase-machine/transition`)
            .body(deploymentPhaseTransitionApplyInputSchema),
    )
    .output(deploymentPhaseTransitionApplyResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

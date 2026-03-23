import z from "zod/v4";
import { route } from "@repo/orpc-utils/builder";
import {
    deploymentPhaseTransitionApplyInputSchema,
    deploymentPhaseTransitionApplyResultSchema,
    deploymentPhaseTransitionsCatalogSchema,
    deploymentPhaseTransitionValidationInputSchema,
    deploymentPhaseTransitionValidationResultSchema,
} from "@repo/api-contracts/common/deployment";

export const deploymentListPhaseTransitionsContract = route({
    method: "GET",
    path: "/phase-machine/transitions",
    summary: "List deployment phase transitions and guard requirements",
})
    .input(
        z.object({
            from: z.string().optional(),
            to: z.string().optional(),
        }),
    )
    .output(deploymentPhaseTransitionsCatalogSchema)
    .build();

export const deploymentValidatePhaseTransitionContract = route({
    method: "POST",
    path: "/phase-machine/validate",
    summary: "Validate deployment phase transition against state-machine guards",
})
    .input((b) => b.body(deploymentPhaseTransitionValidationInputSchema))
    .output(deploymentPhaseTransitionValidationResultSchema)
    .build();

export const deploymentApplyPhaseTransitionContract = route({
    method: "POST",
    path: "/{id}/phase-machine/transition",
    summary: "Apply deployment phase transition with strict transition guard checks",
})
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/phase-machine/transition`)
            .body(deploymentPhaseTransitionApplyInputSchema),
    )
    .output(deploymentPhaseTransitionApplyResultSchema)
    .build();

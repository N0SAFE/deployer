import { route } from "@repo/orpc-utils/builder";
import z from "zod/v4";
import {
    templateCompatibilityMatrixSchema,
    templateCompatibilityValidationInputSchema,
    templateCompatibilityValidationResultSchema,
} from "@repo/contracts-entities";

export const templateGetCompatibilityMatrixContract = route({
    method: "GET",
    path: "/compatibility/matrix",
    summary: "Get template compatibility matrix",
    description: "Returns compatibility combinations for provider, build strategy, deploy strategy, and environment.",
})
    .input(z.object({}))
    .output(templateCompatibilityMatrixSchema)
    .build();

export const templateValidateCompatibilityContract = route({
    method: "POST",
    path: "/compatibility/validate",
    summary: "Validate a template compatibility combination",
})
    .input((b) => b.body(templateCompatibilityValidationInputSchema))
    .output(templateCompatibilityValidationResultSchema)
    .build();

import { route } from "@repo/orpc-utils/builder";
import z from "zod/v4";
import {
    templateSetValidationInputSchema,
    templateSetValidationResultSchema,
    templateValidationInputSchema,
    templateValidationResultSchema,
} from "@repo/contracts-entities";

export const templateValidateStructuralContract = route({
    method: "POST",
    path: "/validate/structural",
    summary: "Validate template structural constraints",
})
    .input((b) =>
        b.body(
            templateValidationInputSchema.extend({
                mode: z.literal("structural"),
            }),
        ),
    )
    .output(templateValidationResultSchema)
    .build();

export const templateValidateSemanticContract = route({
    method: "POST",
    path: "/validate/semantic",
    summary: "Validate template semantic rules",
})
    .input((b) =>
        b.body(
            templateValidationInputSchema.extend({
                mode: z.literal("semantic"),
            }),
        ),
    )
    .output(templateValidationResultSchema)
    .build();

export const templateValidateContract = route({
    method: "POST",
    path: "/validate",
    summary: "Validate template with structural and semantic checks",
})
    .input((b) => b.body(templateValidationInputSchema))
    .output(templateValidationResultSchema)
    .build();

export const templateValidateSetContract = route({
    method: "POST",
    path: "/validate-set",
    summary: "Validate a template set and cross-template semantics",
})
    .input((b) => b.body(templateSetValidationInputSchema))
    .output(templateSetValidationResultSchema)
    .build();

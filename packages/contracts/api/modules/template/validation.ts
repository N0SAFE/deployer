import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import z from "zod/v4";
import {
    templateSetValidationInputSchema,
    templateSetValidationResultSchema,
    templateValidationInputSchema,
    templateValidationResultSchema,
} from "@repo/contracts-entities";

const templateValidationOps = standard.zod(templateValidationResultSchema, "templateValidation");
const templateSetValidationOps = standard.zod(
    templateSetValidationResultSchema,
    "templateSetValidation",
);

export const templateValidateStructuralContract = templateValidationOps
    .create()
    .path("/validate/structural")
    .input((b) =>
        b.body(
            templateValidationInputSchema.extend({
                mode: z.literal("structural"),
            }),
        ),
    )
    .output(templateValidationResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const templateValidateSemanticContract = templateValidationOps
    .create()
    .path("/validate/semantic")
    .input((b) =>
        b.body(
            templateValidationInputSchema.extend({
                mode: z.literal("semantic"),
            }),
        ),
    )
    .output(templateValidationResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const templateValidateContract = templateValidationOps
    .create()
    .path("/validate")
    .input((b) => b.body(templateValidationInputSchema))
    .output(templateValidationResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const templateValidateSetContract = templateSetValidationOps
    .create()
    .path("/validate-set")
    .input((b) => b.body(templateSetValidationInputSchema))
    .output(templateSetValidationResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

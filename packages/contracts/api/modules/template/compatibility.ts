import { standard } from "@repo/orpc-utils";
import z from "zod/v4";
import {
    templateCompatibilityMatrixSchema,
    templateCompatibilityValidationInputSchema,
    templateCompatibilityValidationResultSchema,
} from "@repo/contracts-entities";

const templateCompatibilityMatrixOps = standard.zod(
    templateCompatibilityMatrixSchema,
    "templateCompatibilityMatrix",
);
const templateCompatibilityValidationOps = standard.zod(
    templateCompatibilityValidationResultSchema,
    "templateCompatibilityValidation",
);

export const templateGetCompatibilityMatrixContract = templateCompatibilityMatrixOps
    .list()
    .path("/compatibility/matrix")
    .input(z.object({}))
    .output(templateCompatibilityMatrixSchema)
    .build();

export const templateValidateCompatibilityContract = templateCompatibilityValidationOps
    .create()
    .path("/compatibility/validate")
    .input((b) => b.body(templateCompatibilityValidationInputSchema))
    .output(templateCompatibilityValidationResultSchema)
    .build();

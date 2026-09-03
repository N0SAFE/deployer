import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import {
    templateResolveInputSchema,
    templateResolveResultSchema,
    templateSetResolveInputSchema,
    templateSetResolveResultSchema,
} from "@repo/contracts-entities";

const templateResolveOps = standard.zod(templateResolveResultSchema, "templateResolve");
const templateSetResolveOps = standard.zod(templateSetResolveResultSchema, "templateSetResolve");

export const templateResolveContract = templateResolveOps
    .create()
    .path("/resolve")
    .input((b) => b.body(templateResolveInputSchema))
    .output(templateResolveResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const templateResolveSetContract = templateSetResolveOps
    .create()
    .path("/resolve-set")
    .input((b) => b.body(templateSetResolveInputSchema))
    .output(templateSetResolveResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

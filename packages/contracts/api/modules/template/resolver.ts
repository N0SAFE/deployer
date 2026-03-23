import { route } from "@repo/orpc-utils/builder";
import {
    templateResolveInputSchema,
    templateResolveResultSchema,
    templateSetResolveInputSchema,
    templateSetResolveResultSchema,
} from "@repo/api-contracts/common/template";

export const templateResolveContract = route({
    method: "POST",
    path: "/resolve",
    summary: "Resolve template inheritance chain for a single template kind",
})
    .input((b) => b.body(templateResolveInputSchema))
    .output(templateResolveResultSchema)
    .build();

export const templateResolveSetContract = route({
    method: "POST",
    path: "/resolve-set",
    summary: "Resolve inheritance chains for a full template set",
})
    .input((b) => b.body(templateSetResolveInputSchema))
    .output(templateSetResolveResultSchema)
    .build();

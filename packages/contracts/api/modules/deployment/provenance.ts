import z from "zod/v4";
import { route } from "@repo/orpc-utils/builder";
import {
    deploymentTemplateProvenanceByRunResultSchema,
    deploymentTemplateProvenanceSchema,
    deploymentTemplateProvenanceUpsertInputSchema,
    deploymentTemplateProvenanceUpsertResultSchema,
} from "@repo/api-contracts/common/deployment";

export const deploymentGetTemplateProvenanceContract = route({
    method: "GET",
    path: "/{id}/template-provenance",
    summary: "Get persisted template provenance for a deployment",
})
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/template-provenance`))
    .output(deploymentTemplateProvenanceSchema.nullable())
    .build();

export const deploymentUpsertTemplateProvenanceContract = route({
    method: "PUT",
    path: "/{id}/template-provenance",
    summary: "Persist or update template provenance for a deployment run",
})
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/template-provenance`)
            .body(deploymentTemplateProvenanceUpsertInputSchema),
    )
    .output(deploymentTemplateProvenanceUpsertResultSchema)
    .build();

export const deploymentGetTemplateProvenanceByRunContract = route({
    method: "GET",
    path: "/runs/{runId}/template-provenance",
    summary: "List template provenance records for a deployment run id",
})
    .input((b) => b.params((p) => p`/runs/${p("runId", z.uuid())}/template-provenance`))
    .output(deploymentTemplateProvenanceByRunResultSchema)
    .build();

import z from "zod/v4";
import { standard } from "@repo/orpc-utils";
import {
    deploymentTemplateProvenanceByRunResultSchema,
    deploymentTemplateProvenanceSchema,
    deploymentTemplateProvenanceUpsertInputSchema,
    deploymentTemplateProvenanceUpsertResultSchema,
} from "@repo/contracts-entities";

const deploymentTemplateProvenanceOps = standard.zod(
    deploymentTemplateProvenanceSchema,
    "deploymentTemplateProvenance",
);
const deploymentTemplateProvenanceUpsertOps = standard.zod(
    deploymentTemplateProvenanceUpsertResultSchema,
    "deploymentTemplateProvenanceUpsert",
);
const deploymentTemplateProvenanceByRunOps = standard.zod(
    deploymentTemplateProvenanceByRunResultSchema,
    "deploymentTemplateProvenanceByRun",
);

export const deploymentGetTemplateProvenanceContract = deploymentTemplateProvenanceOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/template-provenance`))
    .output(deploymentTemplateProvenanceSchema.nullable())
    .build();

export const deploymentUpsertTemplateProvenanceContract = deploymentTemplateProvenanceUpsertOps
    .update({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/template-provenance`)
            .body(deploymentTemplateProvenanceUpsertInputSchema),
    )
    .output(deploymentTemplateProvenanceUpsertResultSchema)
    .build();

export const deploymentGetTemplateProvenanceByRunContract = deploymentTemplateProvenanceByRunOps
    .list()
    .input((b) => b.params((p) => p`/runs/${p("runId", z.uuid())}/template-provenance`))
    .output(deploymentTemplateProvenanceByRunResultSchema)
    .build();

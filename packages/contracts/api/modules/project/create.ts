import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { projectSchema } from "@repo/contracts-entities";

const projectOps = standard.zod(projectSchema, "project");

const projectCreateInputSchema = projectSchema
    .omit({ id: true, ownerId: true, createdAt: true, updatedAt: true })
    .extend({
        baseDomain: projectSchema.shape.baseDomain.unwrap().optional(),
        settings: projectSchema.shape.settings.unwrap().optional(),
        // network is optional at create — defaults to null (inherit platform defaults)
        network: projectSchema.shape.network.unwrap().optional(),
    });

export const projectCreateContract = projectOps
    .create()
    .input((b) => b.body(projectCreateInputSchema))
    .errors((e) => [
        // Name collision, org-scope violations, quota limits → typed client catch path.
        ...standardDomainErrorContracts(e),
    ])
    .build();


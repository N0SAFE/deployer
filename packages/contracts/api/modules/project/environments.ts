import z from "zod/v4";
import { route } from "@repo/orpc-utils";
import { environmentTypeSchema, projectEnvironmentSchema } from "@repo/api-contracts/common/project";

const idParam = z.object({ id: z.uuid() });
const envParams = z.object({ id: z.uuid(), environmentId: z.uuid() });

export const projectListEnvironmentsContract = route()
    .method("GET")
    .path("/:id/environments")
    .input(idParam.extend({ type: environmentTypeSchema.optional() }))
    .output(z.object({ environments: z.array(projectEnvironmentSchema) }))
    .build();

export const projectGetEnvironmentContract = route()
    .method("GET")
    .path("/:id/environments/:environmentId")
    .input(envParams)
    .output(projectEnvironmentSchema)
    .build();

export const projectCreateEnvironmentContract = route()
    .method("POST")
    .path("/:id/environments")
    .input(
        idParam.extend({
            name: z.string().min(1).max(100),
            type: environmentTypeSchema,
            description: z.string().optional(),
            domainConfig: projectEnvironmentSchema.shape.domainConfig.optional(),
            deploymentConfig: projectEnvironmentSchema.shape.deploymentConfig.optional(),
            metadata: projectEnvironmentSchema.shape.metadata.optional(),
        }),
    )
    .output(projectEnvironmentSchema)
    .build();

export const projectUpdateEnvironmentContract = route()
    .method("PUT")
    .path("/:id/environments/:environmentId")
    .input(
        envParams.extend({
            name: z.string().min(1).max(100).optional(),
            type: environmentTypeSchema.optional(),
            description: z.string().optional(),
            domainConfig: projectEnvironmentSchema.shape.domainConfig.optional(),
            deploymentConfig: projectEnvironmentSchema.shape.deploymentConfig.optional(),
            metadata: projectEnvironmentSchema.shape.metadata.optional(),
        }),
    )
    .output(projectEnvironmentSchema)
    .build();

export const projectDeleteEnvironmentContract = route()
    .method("DELETE")
    .path("/:id/environments/:environmentId")
    .input(envParams)
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .build();

export const projectCloneEnvironmentContract = route()
    .method("POST")
    .path("/:id/environments/:environmentId/clone")
    .input(
        envParams.extend({
            name: z.string().min(1).max(100),
            type: environmentTypeSchema.optional(),
        }),
    )
    .output(projectEnvironmentSchema)
    .build();

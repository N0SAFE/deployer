import z from "zod/v4";
import { route } from "@repo/orpc-utils";
import { environmentStatusSchema } from "@repo/api-contracts/common/project";

const idParam = z.object({ id: z.uuid() });
const envParams = z.object({ id: z.uuid(), environmentId: z.uuid() });

const scopeSchema = z.enum(["project", "service", "environment", "global"]);

const availableVariableEntrySchema = z.object({
    key: z.string(),
    path: z.string(),
    scope: z.string(),
    description: z.string().nullable(),
    example: z.string().nullable(),
});

const environmentStatusOutputSchema = z.object({
    environmentId: z.uuid(),
    status: environmentStatusSchema,
    servicesCount: z.number(),
    healthyServicesCount: z.number(),
    lastChecked: z.iso.datetime(),
});

export const projectResolveVariablesContract = route()
    .method("POST")
    .path("/:id/resolve-variables")
    .input(
        idParam.extend({
            template: z.string(),
            environmentId: z.uuid().optional(),
            scope: scopeSchema.optional(),
        }),
    )
    .output(
        z.object({
            resolved: z.string(),
            variables: z.record(z.string(), z.string()),
        }),
    )
    .build();

export const projectGetAvailableVariablesContract = route()
    .method("GET")
    .path("/:id/available-variables")
    .input(
        idParam.extend({
            environmentId: z.uuid().optional(),
            scope: scopeSchema.optional(),
        }),
    )
    .output(
        z.object({
            variables: z.array(availableVariableEntrySchema),
            scopes: z.array(
                z.object({
                    scope: z.string(),
                    description: z.string(),
                    variables: z.array(z.string()),
                }),
            ),
        }),
    )
    .build();

export const projectGetEnvironmentStatusContract = route()
    .method("GET")
    .path("/:id/environments/:environmentId/status")
    .input(envParams)
    .output(environmentStatusOutputSchema)
    .build();

export const projectGetAllEnvironmentStatusesContract = route()
    .method("GET")
    .path("/:id/environments/statuses")
    .input(idParam)
    .output(
        z.object({
            statuses: z.array(
                environmentStatusOutputSchema.extend({ environmentName: z.string() }),
            ),
        }),
    )
    .build();

export const projectRefreshEnvironmentStatusContract = route()
    .method("POST")
    .path("/:id/environments/:environmentId/status/refresh")
    .input(envParams)
    .output(
        z.object({
            success: z.boolean(),
            status: environmentStatusSchema,
            lastChecked: z.iso.datetime(),
        }),
    )
    .build();

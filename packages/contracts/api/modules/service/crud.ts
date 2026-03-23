import * as z from "zod";
import { oc } from "@orpc/contract";
import { standard } from "@repo/orpc-utils";
import { serviceSchema } from "@repo/api-contracts/common/service";

const serviceOps = standard.zod(serviceSchema, "service");

export const serviceFindByIdContract = serviceOps
    .read()
    .output((b) => b.entitySchema.nullable())
    .build();

export const serviceDeleteContract = serviceOps.delete().build();

export const serviceCreateInputSchema = serviceSchema
    .omit({ id: true, isActive: true, createdAt: true, updatedAt: true })
    .partial({
        description: true,
        providerConfig: true,
        builderConfig: true,
        port: true,
        environmentVariables: true,
        resourceLimits: true,
        deploymentRetention: true,
        healthCheckPath: true,
        healthCheckInterval: true,
        healthCheckTimeout: true,
        healthCheckRetries: true,
        traefikConfig: true,
        customDomains: true,
        metadata: true,
    });

export type ServiceCreateInput = z.infer<typeof serviceCreateInputSchema>;

export const serviceCreateContract = serviceOps
    .create()
    .input(serviceCreateInputSchema)
    .build();

export const serviceUpdateInputSchema = serviceSchema
    .omit({ id: true, projectId: true, createdAt: true, updatedAt: true })
    .partial()
    .extend({ id: serviceSchema.shape.id });

export type ServiceUpdateInput = z.infer<typeof serviceUpdateInputSchema>;

export const serviceUpdateContract = serviceOps
    .update()
    .input(serviceUpdateInputSchema)
    .build();

export const serviceToggleActiveContract = oc
    .route({
        method: "PATCH",
        path: "/{id}/toggle-active",
        summary: "Toggle service active state",
    })
    .input(z.object({ id: z.uuid(), isActive: z.boolean() }))
    .output(serviceSchema);

export const serviceGetDependenciesContract = oc
    .route({
        method: "GET",
        path: "/{id}/dependencies",
        summary: "Get service dependencies",
    })
    .input(z.object({ id: z.uuid() }))
    .output(
        z.object({
            dependencies: z.array(
                z.object({
                    id: z.uuid(),
                    serviceId: z.uuid(),
                    dependsOnServiceId: z.uuid(),
                    dependsOnService: z.object({
                        id: z.uuid(),
                        name: z.string(),
                        type: z.string(),
                    }),
                    isRequired: z.boolean(),
                    createdAt: z.string(),
                }),
            ),
        }),
    );

export const serviceAddDependencyContract = oc
    .route({
        method: "POST",
        path: "/{id}/dependencies",
        summary: "Add service dependency",
    })
    .input(
        z.object({
            id: z.uuid(),
            dependsOnServiceId: z.uuid(),
            isRequired: z.boolean().default(true),
        }),
    )
    .output(
        z.object({
            id: z.uuid(),
            serviceId: z.uuid(),
            dependsOnServiceId: z.uuid(),
            isRequired: z.boolean(),
            createdAt: z.string(),
        }),
    );

export const serviceRemoveDependencyContract = oc
    .route({
        method: "DELETE",
        path: "/{id}/dependencies/{dependencyId}",
        summary: "Remove service dependency",
    })
    .input(z.object({ id: z.uuid(), dependencyId: z.uuid() }))
    .output(z.object({ success: z.boolean() }));

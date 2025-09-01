import { oc } from '@orpc/contract';
import { z } from 'zod';
import { environmentTypeSchema } from '../../shared';
import { 
  deploymentEnvironmentSchema, 
  createEnvironmentSchema, 
  updateEnvironmentSchema 
} from '../environment/schemas';

// List Environments
export const projectListEnvironmentsInput = z.object({
  id: z.string().uuid(),
  type: environmentTypeSchema.optional(),
});

export const projectListEnvironmentsOutput = z.object({
  environments: z.array(deploymentEnvironmentSchema),
});

export const projectListEnvironmentsContract = oc
  .route({
    method: "GET",
    path: "/:id/environments",
    summary: "List project environments",
  })
  .input(projectListEnvironmentsInput)
  .output(projectListEnvironmentsOutput);

// Get Environment
export const projectGetEnvironmentInput = z.object({
  id: z.string().uuid(),
  environmentId: z.string().uuid(),
});

export const projectGetEnvironmentOutput = deploymentEnvironmentSchema;

export const projectGetEnvironmentContract = oc
  .route({
    method: "GET", 
    path: "/:id/environments/:environmentId",
    summary: "Get environment by ID",
  })
  .input(projectGetEnvironmentInput)
  .output(projectGetEnvironmentOutput);

// Create Environment
export const projectCreateEnvironmentInput = z.object({
  id: z.string().uuid(),
}).merge(createEnvironmentSchema);

export const projectCreateEnvironmentOutput = deploymentEnvironmentSchema;

export const projectCreateEnvironmentContract = oc
  .route({
    method: "POST",
    path: "/:id/environments",
    summary: "Create new environment",
  })
  .input(projectCreateEnvironmentInput)
  .output(projectCreateEnvironmentOutput);

// Update Environment
export const projectUpdateEnvironmentInput = z.object({
  id: z.string().uuid(),
  environmentId: z.string().uuid(),
}).merge(updateEnvironmentSchema);

export const projectUpdateEnvironmentOutput = deploymentEnvironmentSchema;

export const projectUpdateEnvironmentContract = oc
  .route({
    method: "PUT",
    path: "/:id/environments/:environmentId",
    summary: "Update environment",
  })
  .input(projectUpdateEnvironmentInput)
  .output(projectUpdateEnvironmentOutput);

// Delete Environment
export const projectDeleteEnvironmentInput = z.object({
  id: z.string().uuid(),
  environmentId: z.string().uuid(),
});

export const projectDeleteEnvironmentOutput = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const projectDeleteEnvironmentContract = oc
  .route({
    method: "DELETE",
    path: "/:id/environments/:environmentId",
    summary: "Delete environment",
  })
  .input(projectDeleteEnvironmentInput)
  .output(projectDeleteEnvironmentOutput);

// Clone Environment
export const projectCloneEnvironmentInput = z.object({
  id: z.string().uuid(),
  environmentId: z.string().uuid(),
  name: z.string().min(1).max(100),
  type: environmentTypeSchema.optional(),
});

export const projectCloneEnvironmentOutput = deploymentEnvironmentSchema;

export const projectCloneEnvironmentContract = oc
  .route({
    method: "POST",
    path: "/:id/environments/:environmentId/clone",
    summary: "Clone environment with all variables and settings",
  })
  .input(projectCloneEnvironmentInput)
  .output(projectCloneEnvironmentOutput);
import { oc } from '@orpc/contract';
import { z } from 'zod';
import { createVariableTemplateSchema, updateVariableTemplateSchema } from '../../shared';
import { variableTemplateSchema } from './schemas';

// List Variable Templates
export const projectListVariableTemplatesInput = z.object({
  id: z.string().uuid(),
});

export const projectListVariableTemplatesOutput = z.object({
  templates: z.array(variableTemplateSchema),
});

export const projectListVariableTemplatesContract = oc
  .route({
    method: "GET",
    path: "/:id/variable-templates",
    summary: "List variable templates for project",
  })
  .input(projectListVariableTemplatesInput)
  .output(projectListVariableTemplatesOutput);

// Get Variable Template
export const projectGetVariableTemplateInput = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid(),
});

export const projectGetVariableTemplateOutput = variableTemplateSchema;

export const projectGetVariableTemplateContract = oc
  .route({
    method: "GET",
    path: "/:id/variable-templates/:templateId",
    summary: "Get variable template by ID",
  })
  .input(projectGetVariableTemplateInput)
  .output(projectGetVariableTemplateOutput);

// Create Variable Template
export const projectCreateVariableTemplateInput = z.object({
  id: z.string().uuid(),
}).merge(createVariableTemplateSchema);

export const projectCreateVariableTemplateOutput = variableTemplateSchema;

export const projectCreateVariableTemplateContract = oc
  .route({
    method: "POST",
    path: "/:id/variable-templates",
    summary: "Create variable template",
  })
  .input(projectCreateVariableTemplateInput)
  .output(projectCreateVariableTemplateOutput);

// Update Variable Template
export const projectUpdateVariableTemplateInput = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid(),
}).merge(updateVariableTemplateSchema);

export const projectUpdateVariableTemplateOutput = variableTemplateSchema;

export const projectUpdateVariableTemplateContract = oc
  .route({
    method: "PUT",
    path: "/:id/variable-templates/:templateId",
    summary: "Update variable template",
  })
  .input(projectUpdateVariableTemplateInput)
  .output(projectUpdateVariableTemplateOutput);

// Delete Variable Template
export const projectDeleteVariableTemplateInput = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid(),
});

export const projectDeleteVariableTemplateOutput = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const projectDeleteVariableTemplateContract = oc
  .route({
    method: "DELETE",
    path: "/:id/variable-templates/:templateId",
    summary: "Delete variable template",
  })
  .input(projectDeleteVariableTemplateInput)
  .output(projectDeleteVariableTemplateOutput);
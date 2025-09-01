import { oc } from '@orpc/contract';
import { createProjectSchema, projectSchema } from './schemas';

export const projectCreateInput = createProjectSchema;

export const projectCreateOutput = projectSchema;

export const projectCreateContract = oc
  .route({
    method: "POST",
    path: "/",
    summary: "Create new project",
  })
  .input(projectCreateInput)
  .output(projectCreateOutput);
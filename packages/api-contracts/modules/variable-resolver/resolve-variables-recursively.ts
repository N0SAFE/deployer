import { oc } from '@orpc/contract';
import { resolveVariablesRecursivelyInput, resolveVariablesRecursivelyOutput } from './schemas';

export const resolveVariablesRecursivelyContract = oc
  .route({
    method: 'POST',
    path: '/resolve-variables-recursively',
    summary: 'Resolve variables with recursive dependencies',
    description: 'Resolve multiple variables that may reference each other, detecting and handling circular dependencies',
  })
  .input(resolveVariablesRecursivelyInput)
  .output(resolveVariablesRecursivelyOutput);
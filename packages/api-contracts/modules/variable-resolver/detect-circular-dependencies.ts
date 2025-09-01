import { oc } from '@orpc/contract';
import { detectCircularDependenciesInput, detectCircularDependenciesOutput } from './schemas';

export const detectCircularDependenciesContract = oc
  .route({
    method: 'POST',
    path: '/detect-circular-dependencies',
    summary: 'Detect circular dependencies in variables',
    description: 'Analyze variable dependencies to detect circular references and dependency cycles',
  })
  .input(detectCircularDependenciesInput)
  .output(detectCircularDependenciesOutput);
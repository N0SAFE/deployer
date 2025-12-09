import { oc } from '@orpc/contract';
import { extractReferencesInput, extractReferencesOutput } from './schemas';
export const extractReferencesContract = oc
    .route({
    method: 'POST',
    path: '/extract-references',
    summary: 'Extract all variable references from templates',
    description: 'Extract and analyze all variable references from multiple template strings',
})
    .input(extractReferencesInput)
    .output(extractReferencesOutput);

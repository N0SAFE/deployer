import { oc } from '@orpc/contract';
import { resolveTemplateInput, resolveTemplateOutput } from './schemas';
export const resolveTemplateContract = oc
    .route({
    method: 'POST',
    path: '/resolve-template',
    summary: 'Resolve variable template with context',
    description: 'Resolve a template string by substituting variable references with actual values from the provided context',
})
    .input(resolveTemplateInput)
    .output(resolveTemplateOutput);

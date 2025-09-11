import { oc } from '@orpc/contract';
import { validateTemplateInput, validateTemplateOutput } from './schemas';
export const validateTemplateContract = oc
    .route({
    method: 'POST',
    path: '/validate-template',
    summary: 'Validate variable template syntax',
    description: 'Validate template syntax and check for potential issues like circular dependencies or invalid references',
})
    .input(validateTemplateInput)
    .output(validateTemplateOutput);

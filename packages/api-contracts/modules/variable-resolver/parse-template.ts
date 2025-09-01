import { oc } from '@orpc/contract';
import { parseTemplateInput, parseTemplateOutput } from './schemas';

export const parseTemplateContract = oc
  .route({
    method: 'POST',
    path: '/parse-template',
    summary: 'Parse variable template and extract references',
    description: 'Parse a template string to identify variable references, validate syntax, and extract metadata',
  })
  .input(parseTemplateInput)
  .output(parseTemplateOutput);
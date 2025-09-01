import { oc } from '@orpc/contract';
import { getSuggestionsInput, getSuggestionsOutput } from './schemas';

export const getSuggestionsContract = oc
  .route({
    method: 'POST',
    path: '/get-suggestions',
    summary: 'Get variable suggestions for autocomplete',
    description: 'Get suggestions for variable references based on partial input and available context',
  })
  .input(getSuggestionsInput)
  .output(getSuggestionsOutput);
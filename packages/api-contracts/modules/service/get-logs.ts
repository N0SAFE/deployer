import { oc } from '@orpc/contract';
import { getServiceLogsInput, getServiceLogsOutput } from './schemas';

export const serviceGetLogsContract = oc
  .route({
    method: 'GET',
    path: '/:id/logs',
    summary: 'Get service logs',
    description: 'Retrieve logs for a specific service with filtering and pagination',
  })
  .input(getServiceLogsInput)
  .output(getServiceLogsOutput);
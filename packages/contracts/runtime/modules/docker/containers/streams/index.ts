import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'

import { dockerContainerInspectStreamContract } from './inspect'
import { dockerContainerLogsStreamContract } from './logs'
import { dockerContainerProcessLogsStreamContract } from './process-logs'
import { dockerContainerProcessesStreamContract } from './processes'

export const dockerContainerStreamsContract = oc
    .meta(openapi({ tags: ['Docker Container Streams'] }))
    .router({
        inspect: dockerContainerInspectStreamContract,
        logs: dockerContainerLogsStreamContract,
        processes: dockerContainerProcessesStreamContract,
        processLogs: dockerContainerProcessLogsStreamContract,
    })

export {
    dockerContainerInspectStreamContract,
    dockerContainerLogsStreamContract,
    dockerContainerProcessesStreamContract,
    dockerContainerProcessLogsStreamContract,
}

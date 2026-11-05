import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'

import { dockerContainerTerminalCloseContract } from './close'
import { dockerContainerTerminalInputContract } from './input'
import { dockerContainerTerminalOpenContract } from './open'
import { dockerContainerTerminalStreamContract } from './stream'

export const dockerContainerTerminalContract = oc
    .meta(openapi({ tags: ['Docker Container Terminal'], prefix: '/terminal' }))
    .router({
        open: dockerContainerTerminalOpenContract,
        stream: dockerContainerTerminalStreamContract,
        sendInput: dockerContainerTerminalInputContract,
        close: dockerContainerTerminalCloseContract,
    })

export {
    dockerContainerTerminalOpenContract,
    dockerContainerTerminalStreamContract,
    dockerContainerTerminalInputContract,
    dockerContainerTerminalCloseContract,
}

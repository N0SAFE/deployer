import z from 'zod/v4'

import { access } from '@deployer/auth/authz/meta'
import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

export const sendTestNotificationOutputSchema = z.object({
    success: z.number(),
    failed: z.number(),
    total: z.number(),
})

const pushSendTestNotificationOps = standard.zod(
    sendTestNotificationOutputSchema,
    'pushSendTestNotification'
)

export const sendTestNotificationContract = pushSendTestNotificationOps
    .create()
    .path('/test')
    .input(z.object({}))
    .output(sendTestNotificationOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(
        access({
            self: true,
            reason: 'the caller manages their own devices and notifications',
        })
    )
    .build()

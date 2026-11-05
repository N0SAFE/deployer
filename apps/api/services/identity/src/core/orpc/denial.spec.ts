import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    UserForbidden,
    UserInvalid,
} from '@identity/modules/user/domain/user.errors'

import { reportDenial, setDenialSink, type DenialEvent } from './denial'

const context = {
    auth: { user: { id: 'user-1', role: 'admin' } },
    request: {
        headers: new Headers({
            'x-forwarded-for': '10.0.0.9',
            'user-agent': 'vitest',
        }),
    },
}

describe('denial reporting', () => {
    afterEach(() => {
        setDenialSink(undefined)
    })

    it('records a refusal with the actor and the correlation id', () => {
        const events: DenialEvent[] = []
        setDenialSink((event) => {
            events.push(event)
        })

        reportDenial(
            context,
            new UserForbidden({ reason: 'actor lacks user:delete' }),
            'cid-1'
        )

        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
            action: 'access-denied',
            actorId: 'user-1',
            ip: '10.0.0.9',
            userAgent: 'vitest',
            detail: {
                tag: 'UserForbidden',
                kind: 'forbidden',
                correlationId: 'cid-1',
                message: 'actor lacks user:delete',
            },
        })
    })

    it('does not record a validation failure: a typo is not an access attempt', () => {
        const record = vi.fn()
        setDenialSink(record)

        reportDenial(context, new UserInvalid({ reason: 'bad input' }), 'cid-2')

        expect(record).not.toHaveBeenCalled()
    })

    it('is silent when no sink is installed', () => {
        expect(() => {
            reportDenial(
                context,
                new UserForbidden({ reason: 'nope' }),
                'cid-3'
            )
        }).not.toThrow()
    })
})

'use client'

import { useEffect } from 'react'

import redirect from '@/actions/redirect'

export default function RedirectAfterDelay({
    delay,
    to,
}: {
    delay: number
    to: string
}) {
    useEffect(() => {
        const timeout = setTimeout(() => {
            void redirect(to)
        }, delay)
        return () => { clearTimeout(timeout); }
    }, [delay, to])
    return null
}

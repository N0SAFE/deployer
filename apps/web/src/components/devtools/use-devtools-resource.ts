'use client'

import { useCallback, useEffect, useState } from 'react'

interface ResourceState<T> {
    data: T | null
    error: string | null
    loading: boolean
}

export interface DevtoolsResource<T> extends ResourceState<T> {
    /** Show the loading state again and re-run the fetcher. */
    reload: () => void
}

/**
 * Load a devtools panel's data once on mount, and again on `reload()`.
 *
 * `fetcher` must be referentially stable (a module-level function): it is an
 * effect dependency. It signals failure by throwing; the message is surfaced as
 * `error`. A failed reload keeps the previous `data` so the panel does not blank.
 *
 * State is only ever set from the promise callbacks, never synchronously inside
 * the effect, so it does not trigger a cascading render.
 */
export function useDevtoolsResource<T>(fetcher: () => Promise<T>): DevtoolsResource<T> {
    const [state, setState] = useState<ResourceState<T>>({ data: null, error: null, loading: true })
    const [version, setVersion] = useState(0)

    useEffect(() => {
        let cancelled = false
        fetcher()
            .then((data) => {
                if (!cancelled) setState({ data, error: null, loading: false })
            })
            .catch((err: unknown) => {
                if (cancelled) return
                const message = err instanceof Error ? err.message : 'Request failed'
                setState((prev) => ({ ...prev, error: message, loading: false }))
            })
        return () => {
            cancelled = true
        }
    }, [fetcher, version])

    const reload = useCallback(() => {
        setState((prev) => ({ ...prev, error: null, loading: true }))
        setVersion((v) => v + 1)
    }, [])

    return { ...state, reload }
}

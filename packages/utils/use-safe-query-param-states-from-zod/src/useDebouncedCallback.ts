/**
 * Tiny self-contained debounce hook used by the setter of
 * `useSafeQueryParamStatesFromZod`. Kept separate so the main hook file
 * stays focused on its public contract.
 */
import { useCallback, useEffect, useRef } from 'react'

/**
 * Debounce a callback. The returned function delays the original
 * `callback` invocation by `delay` ms; subsequent calls within that
 * window reset the timer.
 *
 * Cleanup runs on unmount to avoid stale timer firings.
 */
export function useDebouncedCallback<T extends (...args: never[]) => unknown>(
    callback: T,
    delay: number
): (...args: Parameters<T>) => void {
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const callbackRef = useRef<T>(callback)

    useEffect(() => {
        callbackRef.current = callback
    }, [callback])

    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current)
            }
        }
    }, [])

    return useCallback(
        (...args: Parameters<T>) => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current)
            }
            timeoutRef.current = setTimeout(() => {
                callbackRef.current(...args)
            }, delay)
        },
        [delay]
    )
}

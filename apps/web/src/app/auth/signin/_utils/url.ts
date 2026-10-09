/**
 * Read one query parameter without a suspending hook.
 *
 * `useSearchParams()` suspends during a client prerender, which pushed the
 * sign-in content out of its static shell. `window.location.search` holds the
 * same value once mounted, and is read lazily — inside an effect or an event
 * handler. Returns `undefined` during SSR.
 */
export function readUrlSearchParam(key: string): string | undefined {
  if (typeof window === 'undefined') return undefined
  return new URLSearchParams(window.location.search).get(key) ?? undefined
}

/** Post-sign-in destination, resolved at SUBMIT time: redirectTo ?? callbackUrl ?? '/'. */
export function getPostSignInTarget(): string {
  return readUrlSearchParam('redirectTo') ?? readUrlSearchParam('callbackUrl') ?? '/'
}

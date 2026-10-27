import { useState } from 'react'

/**
 * Runs `handler` during render when any value in `deps` changed since the last
 * render, so state derived from props or query data is adjusted without the extra
 * commit an effect would cause (see "Adjusting some state when a prop changes" in
 * the React docs). Use it instead of `useEffect(() => setState(...), deps)`.
 *
 * `handler` may call `setState` of the owning component; it must not touch refs,
 * the DOM or the network. With `runOnMount` (default) it also runs on first
 * render, matching the effect it replaces; pass `false` for "reset when X changes".
 */
export function useOnDepsChange(deps: readonly unknown[], handler: () => void, runOnMount = true): void {
  const [previous, setPrevious] = useState<readonly unknown[] | null>(runOnMount ? null : deps)
  if (depsChanged(previous, deps)) {
    setPrevious(deps)
    handler()
  }
}

function depsChanged(previous: readonly unknown[] | null, deps: readonly unknown[]): boolean {
  if (previous === null) return true
  if (previous.length !== deps.length) return true
  return deps.some((value, index) => !Object.is(value, previous[index]))
}

import * as React from "react"

const MOBILE_BREAKPOINT = 768

function subscribe(onStoreChange: () => void): () => void {
  const mql = window.matchMedia(`(max-width: ${String(MOBILE_BREAKPOINT - 1)}px)`)
  mql.addEventListener("change", onStoreChange)
  return () => {
    mql.removeEventListener("change", onStoreChange)
  }
}

function getSnapshot(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT
}

/** Server render has no viewport; assume desktop so markup stays stable. */
function getServerSnapshot(): boolean {
  return false
}

/**
 * Tracks whether the viewport is below the mobile breakpoint.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: reading
 * `matchMedia` in an effect and calling `setState` synchronously is what the
 * `set-state-in-effect` rule flags — it schedules a second render after first
 * paint. This reads the value during render and subscribes for updates, so
 * there is no cascading render and no hydration mismatch.
 */
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

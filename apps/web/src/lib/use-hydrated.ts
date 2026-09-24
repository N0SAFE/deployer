"use client";

import { useSyncExternalStore } from "react";

/**
 * The snapshot never changes, so there is nothing to subscribe to and nothing to
 * clean up. The unsubscribe is an expression-bodied arrow rather than an empty
 * block because `@typescript-eslint/no-empty-function` rejects the latter.
 */
const subscribe = (): (() => void) => () => undefined;

/**
 * `false` during server rendering and the client's first hydration render, then
 * `true` forever after.
 *
 * WHY THIS EXISTS
 * ---------------
 * A value that can only be known in the browser must not be rendered during the
 * first client render either, or React finds the server's HTML disagreeing with
 * it and throws:
 *
 *   "Hydration failed because the server rendered text didn't match the client.
 *    As a result this tree will be regenerated on the client."
 *
 * The concrete case: a `useQuery`-derived count. On the server the query cache is
 * empty, so `isLoading` is true and the tile renders an em dash. On the client the
 * cache may already be warm, so the same tile renders a number on its very first
 * pass — a mismatch that regenerates the subtree, throwing away the server HTML
 * that was already correct.
 *
 * Gating on this hook makes both passes agree (`false` → the same placeholder),
 * and the real value arrives in the normal update immediately after hydration.
 * The one-frame placeholder is the price of a stable first paint.
 *
 * Implemented with `useSyncExternalStore` rather than `useState` + `useEffect`
 * because the latter is a setState-in-effect, which this repo's lint rules
 * (correctly) reject: it would trigger a cascading second render.
 *
 * @example
 * const hydrated = useHydrated();
 * <Item value={hydrated ? items.length : undefined} />
 */
export function useHydrated(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => true,
		() => false,
	);
}

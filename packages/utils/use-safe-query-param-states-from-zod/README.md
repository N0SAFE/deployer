# @repo/use-safe-query-param-states-from-zod

Type-safe, reactive accessor for a route's URL search state. Built on top
of [`nuqs`](https://nuqs.47ng.com/) so updates flow through the address
bar and any subscribed components.

## Installation

This package is part of the monorepo and is consumed via the workspace
alias `@repo/use-safe-query-param-states-from-zod`.

## API

### `useSafeQueryParamStatesFromZod(schema, options?)`

```ts
import { z } from 'zod'
import { useSafeQueryParamStatesFromZod } from '@repo/use-safe-query-param-states-from-zod'

const Filters = z.object({
    q: z.string().default(''),
    page: z.number().int().min(1).default(1),
})

function Component() {
    const [filters, setFilters] = useSafeQueryParamStatesFromZod(Filters, {
        delay: 200, // debounce writes (ms)
    })

    return (
        <input
            value={filters.q}
            onChange={(event) =>
                setFilters({ q: event.target.value })
            }
        />
    )
}
```

Returns a `[state, setState]` tuple where:

- `state` is the fully-typed Zod output (`z.infer<typeof schema>`) with
  every field populated by its default when missing from the URL.
- `setState` accepts a partial payload (or `null` to reset).

### `useRouteSearchBuilder(route, options?)`

Drop-in helper that combines `useSafeQueryParamStatesFromZod` with a
`RouteBuilder` and exposes navigation helpers (`push`, `replace`,
`reset`, `buildUrl`).

```ts
import { useRouteSearchBuilder } from '@repo/use-safe-query-param-states-from-zod'

const search = useRouteSearchBuilder(MyRoute, { delay: 300 })
search.push({ page: 2 })
search.reset()
```

## Lower-level helpers

The module also re-exports the building blocks used by the hook so
advanced consumers can plug in custom parsers or default-extraction
strategies:

- `createParserForZodField(schema, includeDefault?)`
- `getZodObjectDefaults(schema)`
- `getZodObjectShallowDefaults(schema)`
- `mergeWithDefaults(schema, rawValues)`
- `useDebouncedCallback(callback, delay)`

## Design notes

- **Zero `any` in the public surface.** The package owns the
  `nuqs` `SingleParser<T>` ↔ `unknown` widening inside `parsers.ts` so
  every other module is strictly typed.
- **Zod v4 compatible.** Introspection (`getZodKind`, `unwrapZodSchema`,
  `getZodDefault`) checks both `def` (v4) and `_def` (legacy) shapes.
- **Defaults are fully recursive.** Nested objects and arrays get
  populated automatically so consumers never see partially-typed
  state.
- **Backward-compatible.** The hook is also re-exported as
  `useSafeQueryStatesFromZod` and the options type as
  `QueryStateFromZodOptions` so existing imports keep working.
